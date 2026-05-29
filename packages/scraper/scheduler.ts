import './load-env.js';

import { spawn } from 'node:child_process';
import { env } from '@pulsar/shared/config/env';
import { getClient as getPgClient, query } from '@pulsar/shared/db/postgres';
import cron from 'node-cron';
import { enqueueMonthlyCoverage } from './backfill/auto-enqueue.js';
import { scrape } from './index.js';
import { ScrapeTimeoutError, withScrapeTimeout } from './lib/scrape-timeout.js';

// Fixed advisory lock ID for the scheduler singleton
const SCHEDULER_LOCK_ID = 73952;

// When reclaiming a stale advisory lock via pg_terminate_backend, the killed
// pool connection emits two unhandled errors: 57P01 (admin_shutdown) from
// PostgreSQL, then "Connection terminated unexpectedly" from the socket close.
// Both fire on the raw Client before the pool can intercept them.
let reclaimingLock = false;
process.on('uncaughtException', (err: Error & { code?: string }) => {
	if (reclaimingLock && (err.code === '57P01' || err.message?.includes('terminated unexpectedly')))
		return;
	// Emit a single-line JSON record instead of the full stack. The previous
	// console.error dumped each nested error (AggregateError on ECONNREFUSED
	// expands to one frame per address family), and when pm2 restarts the
	// process instantly this turns into hundreds of thousands of duplicated
	// stacks. On 2026-05-28 the scheduler-error.log hit 900 MB this way.
	const firstStackFrame = err.stack?.split('\n').slice(0, 2).join(' ');
	process.stderr.write(
		`${JSON.stringify({
			ts: new Date().toISOString(),
			level: 'error',
			component: 'scheduler',
			message: 'uncaught-exception',
			code: err.code,
			errorMessage: err.message,
			stack: firstStackFrame
		})}\n`
	);
	process.exit(1);
});

let scrapeRunning = false;
let pipelineRunning = false;
let retrospectiveRunning = false;

const RELOAD_INTERVAL_MS = 60_000;
const BACKFILL_TICK_INTERVAL_MS = 15 * 60_000;

// Fail-safe ceiling on a single scrape run. A healthy full scrape finishes in
// 2-3 minutes; 30 minutes is a comfortable upper bound. If a source adapter
// ever wedges, this prevents `scrapeRunning` from getting stuck `true` and
// silently killing every future scheduled tick.
const SCRAPE_MAX_DURATION_MS = 30 * 60_000;

interface ScheduleRow {
	type: string;
	hour: number;
	minute: number;
	days: number[];
	active: boolean;
}

type Task = ReturnType<typeof cron.schedule>;
const activeTasks: Task[] = [];

function toCron(hour: number, minute: number, days: number[]): string {
	const dayList = days.length === 7 ? '*' : days.join(',');
	return `${minute} ${hour} * * ${dayList}`;
}

async function loadSchedules(): Promise<ScheduleRow[]> {
	try {
		const result = await query<ScheduleRow>(
			'SELECT type, hour, minute, days, active FROM schedules WHERE active = true'
		);
		return result.rows;
	} catch {
		// Table may not exist yet, fall back to env
		return [];
	}
}

function clearTasks() {
	for (const task of activeTasks) task.stop();
	activeTasks.length = 0;
}

function triggerPipeline() {
	if (pipelineRunning) {
		console.log('[Scheduler] Pipeline skipped: previous run still in progress.');
		return;
	}
	pipelineRunning = true;
	console.log(`[Scheduler] Pipeline triggered at ${new Date().toISOString()}`);
	const child = spawn(
		'pnpm',
		['--filter', '@pulsar/pipeline', 'run', 'pipeline', '--', '--scheduled'],
		{
			stdio: 'inherit',
			detached: false
		}
	);
	child.on('close', (code) => {
		pipelineRunning = false;
		if (code === 0) {
			console.log('[Scheduler] Pipeline complete.');
		} else {
			console.error(`[Scheduler] Pipeline exited with code ${code}`);
		}
	});
}

// Adapter so the strongly-typed `pg` query (which constrains T to
// QueryResultRow) satisfies the DbExecutor surface used by backfill helpers.
const dbExecutor = {
	query: async <T = unknown>(sql: string, params?: unknown[]) => {
		const result = await query(sql, params);
		return { rows: result.rows as unknown as T[], rowCount: result.rowCount };
	}
};

async function runBackfillTick(): Promise<void> {
	if (!env.backfill.enabled) return;
	try {
		const result = await enqueueMonthlyCoverage(dbExecutor);
		if (result.enqueued.length > 0) {
			console.log(`[Scheduler] Month-fill enqueued: ${result.enqueued.join(', ')}`);
		}
	} catch (err) {
		console.error('[Scheduler] Backfill tick failed:', err);
	}
}

function registerScrape(cronExpr: string) {
	console.log(`[Scheduler] Scrape registered: ${cronExpr}`);
	const task = cron.schedule(cronExpr, async () => {
		if (scrapeRunning) {
			console.log('[Scheduler] Scrape skipped, previous run still in progress.');
			return;
		}
		scrapeRunning = true;
		console.log(`[Scheduler] Scrape triggered at ${new Date().toISOString()}`);
		try {
			await withScrapeTimeout(() => scrape(undefined, 'scheduled'), SCRAPE_MAX_DURATION_MS);
			console.log('[Scheduler] Scrape complete.');
		} catch (err) {
			if (err instanceof ScrapeTimeoutError) {
				console.error(`[Scheduler] FATAL: ${err.message}. Self-healing for next tick.`);
			} else {
				console.error('[Scheduler] Scrape failed:', err);
			}
		} finally {
			scrapeRunning = false;
		}
		await runBackfillTick();
	});
	activeTasks.push(task);
}

function registerPipeline(cronExpr: string) {
	console.log(`[Scheduler] Pipeline registered: ${cronExpr}`);
	const task = cron.schedule(cronExpr, () => triggerPipeline());
	activeTasks.push(task);
}

function triggerRetrospective() {
	if (retrospectiveRunning) {
		console.log('[Scheduler] Retrospective skipped, previous run still in progress.');
		return;
	}
	retrospectiveRunning = true;
	console.log(`[Scheduler] Retrospective triggered at ${new Date().toISOString()}`);
	const child = spawn(
		'pnpm',
		['--filter', '@pulsar/pipeline', 'run', 'retrospective', '--', '--scheduled'],
		{ stdio: 'inherit', detached: false }
	);
	child.on('close', (code) => {
		retrospectiveRunning = false;
		if (code === 0) {
			console.log('[Scheduler] Retrospective complete.');
		} else {
			console.error(`[Scheduler] Retrospective exited with code ${code}`);
		}
	});
}

function registerRetrospective(cronExpr: string) {
	console.log(`[Scheduler] Retrospective registered: ${cronExpr}`);
	const task = cron.schedule(cronExpr, () => triggerRetrospective());
	activeTasks.push(task);
}

function scheduleFingerprint(schedules: ScheduleRow[]): string {
	return JSON.stringify(
		schedules.map((s) => `${s.type}:${s.hour}:${s.minute}:${s.days.join(',')}`).sort()
	);
}

function applySchedules(schedules: ScheduleRow[]) {
	clearTasks();

	const scrapeSchedules = schedules.filter((s) => s.type === 'scrape');
	const pipelineSchedules = schedules.filter((s) => s.type === 'pipeline');
	const retrospectiveSchedules = schedules.filter((s) => s.type === 'retrospective');

	if (scrapeSchedules.length === 0) {
		console.log(`[Scheduler] No scrape schedules in DB, using env: ${env.scraper.cron}`);
		registerScrape(env.scraper.cron);
	} else {
		for (const s of scrapeSchedules) {
			registerScrape(toCron(s.hour, s.minute, s.days));
		}
	}

	for (const s of pipelineSchedules) {
		registerPipeline(toCron(s.hour, s.minute, s.days));
	}

	for (const s of retrospectiveSchedules) {
		registerRetrospective(toCron(s.hour, s.minute, s.days));
	}

	console.log(
		`[Scheduler] ${scrapeSchedules.length || 1} scrape + ${pipelineSchedules.length} pipeline + ${retrospectiveSchedules.length} retrospective schedule(s) active.`
	);
}

let lastFingerprint = '';

async function reloadIfChanged() {
	try {
		const schedules = await loadSchedules();
		const fp = scheduleFingerprint(schedules);
		if (fp !== lastFingerprint) {
			console.log('[Scheduler] Schedule change detected, reloading...');
			lastFingerprint = fp;
			applySchedules(schedules);
		}
	} catch (err) {
		console.error('[Scheduler] Failed to check for schedule changes:', err);
	}
}

async function acquireLock(): Promise<
	ReturnType<typeof getPgClient> extends Promise<infer T> ? T : never
> {
	const lockClient = await getPgClient();
	const lockResult = await lockClient.query<{ locked: boolean }>(
		'SELECT pg_try_advisory_lock($1) AS locked',
		[SCHEDULER_LOCK_ID]
	);
	if (lockResult.rows[0].locked) return lockClient;

	// Lock held by another connection. Check if the holder is a stale idle connection
	// (previous process died without releasing the pool connection).
	const stale = await lockClient.query<{ pid: number }>(
		`SELECT l.pid FROM pg_locks l
     JOIN pg_stat_activity a ON a.pid = l.pid
     WHERE l.locktype = 'advisory' AND l.objid = $1 AND l.granted = true AND a.state = 'idle'`,
		[SCHEDULER_LOCK_ID]
	);

	if (stale.rows.length > 0) {
		console.log(`[Scheduler] Terminating stale lock holder (pid ${stale.rows[0].pid})...`);
		reclaimingLock = true;
		await lockClient.query('SELECT pg_terminate_backend($1)', [stale.rows[0].pid]);
		// Retry with backoff: PostgreSQL releases the lock asynchronously after session cleanup
		for (let attempt = 0; attempt < 5; attempt++) {
			await new Promise((r) => setTimeout(r, 1000));
			const retry = await lockClient.query<{ locked: boolean }>(
				'SELECT pg_try_advisory_lock($1) AS locked',
				[SCHEDULER_LOCK_ID]
			);
			if (retry.rows[0].locked) {
				reclaimingLock = false;
				return lockClient;
			}
		}
		reclaimingLock = false;
	}

	lockClient.release();
	console.error('[Scheduler] Another scheduler is already running. Exiting.');
	process.exit(1);
}

async function main() {
	// Acquire advisory lock to ensure only one scheduler process runs at a time.
	// If the lock is held by a stale idle connection (dead process), reclaim it.
	const lockClient = await acquireLock();
	console.log('[Scheduler] Advisory lock acquired.');

	const schedules = await loadSchedules();
	lastFingerprint = scheduleFingerprint(schedules);
	applySchedules(schedules);

	setInterval(reloadIfChanged, RELOAD_INTERVAL_MS);
	console.log('[Scheduler] Started. Polling for schedule changes every 60s.');

	// Backfill tick is independent of the scrape cron so the auto-enqueue and
	// gap-fill paths get a chance to run on boot and at least every 15 minutes,
	// rather than only after the once-a-day scrape cron fires.
	if (env.backfill.enabled) {
		await runBackfillTick();
		setInterval(runBackfillTick, BACKFILL_TICK_INTERVAL_MS);
		console.log('[Scheduler] Backfill tick scheduled every 15 minutes.');
	}

	process.on('SIGINT', () => {
		console.log('\n[Scheduler] Shutting down...');
		clearTasks();
		lockClient.release();
		process.exit(0);
	});
}

main();
