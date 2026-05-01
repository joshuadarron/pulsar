import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), '../../../../.env') });

import { env } from '@pulsar/shared/config/env';
import { getClient } from '@pulsar/shared/db/postgres';

import { insertBackfilledItems } from './insert.js';
import type { ClaimedJob } from './queue.js';
import { claimJobs, completeJob, failJob } from './queue.js';
import { getStrategy } from './strategies/index.js';

const BACKFILL_LOCK_ID = 73953;
const POLL_INTERVAL_MS = 5000;

type LogFields = Record<string, unknown>;

function log(level: 'info' | 'warn' | 'error', message: string, fields: LogFields = {}): void {
	const entry = {
		ts: new Date().toISOString(),
		level,
		component: 'backfill-worker',
		message,
		...fields
	};
	const stream = level === 'error' ? process.stderr : process.stdout;
	stream.write(`${JSON.stringify(entry)}\n`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timeout = setTimeout(resolve, ms);
		if (signal) {
			const onAbort = () => {
				clearTimeout(timeout);
				resolve();
			};
			if (signal.aborted) onAbort();
			else signal.addEventListener('abort', onAbort, { once: true });
		}
	});
}

type LockClient = Awaited<ReturnType<typeof getClient>>;

async function tryAcquireAdvisoryLock(client: LockClient, lockId: number): Promise<boolean> {
	const result = await client.query<{ locked: boolean }>(
		'SELECT pg_try_advisory_lock($1) AS locked',
		[lockId]
	);
	return result.rows[0]?.locked === true;
}

/**
 * Process a single claimed job: dispatch to strategy, insert results, and
 * mark the job complete or failed. Errors are caught here so the worker
 * loop never crashes from a single bad job.
 */
async function processJob(
	executor: LockClient,
	job: ClaimedJob,
	signal: AbortSignal
): Promise<void> {
	const startedAt = Date.now();
	log('info', 'job.start', {
		jobId: job.id,
		sourceName: job.sourceName,
		windowStart: job.windowStart,
		windowEnd: job.windowEnd,
		strategy: job.strategy
	});
	try {
		const strategy = getStrategy(job.sourceName);
		const result = await strategy({
			sourceName: job.sourceName,
			windowStart: job.windowStart,
			windowEnd: job.windowEnd,
			backfillRunId: job.backfillRunId ?? '',
			signal
		});
		const inserted = await insertBackfilledItems(executor, result.items, job.backfillRunId ?? '');
		await completeJob(executor, job.id, inserted);
		log('info', 'job.complete', {
			jobId: job.id,
			sourceName: job.sourceName,
			itemsFromStrategy: result.items.length,
			inserted,
			strategyErrors: result.errors.length,
			durationMs: Date.now() - startedAt
		});
	} catch (err: unknown) {
		const error = err instanceof Error ? err : new Error(String(err));
		log('error', 'job.failed', {
			jobId: job.id,
			sourceName: job.sourceName,
			message: error.message,
			durationMs: Date.now() - startedAt
		});
		try {
			await failJob(executor, job.id, error);
		} catch (failErr: unknown) {
			log('error', 'job.fail-record-failed', {
				jobId: job.id,
				message: failErr instanceof Error ? failErr.message : String(failErr)
			});
		}
	}
}

type WorkerLoopOptions = {
	workerId: string;
	concurrency: number;
	pollIntervalMs?: number;
	abortSignal: AbortSignal;
	executor: LockClient;
};

/**
 * Main worker loop. Claims up to `concurrency` jobs at a time, processes
 * them in parallel, and sleeps for `pollIntervalMs` when the queue is empty.
 * Exits cleanly when `abortSignal` aborts.
 */
export async function workerLoop(options: WorkerLoopOptions): Promise<void> {
	const pollMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
	while (!options.abortSignal.aborted) {
		let jobs: ClaimedJob[];
		try {
			jobs = await claimJobs(options.executor, options.workerId, options.concurrency);
		} catch (err: unknown) {
			log('error', 'claim.failed', {
				message: err instanceof Error ? err.message : String(err)
			});
			await sleep(pollMs, options.abortSignal);
			continue;
		}

		if (jobs.length === 0) {
			await sleep(pollMs, options.abortSignal);
			continue;
		}

		await Promise.all(jobs.map((job) => processJob(options.executor, job, options.abortSignal)));
	}
}

async function main(): Promise<void> {
	const lockClient = await getClient();
	const acquired = await tryAcquireAdvisoryLock(lockClient, BACKFILL_LOCK_ID);
	if (!acquired) {
		log('info', 'lock.not-acquired', {
			message: 'Another backfill worker is already running. Exiting.',
			lockId: BACKFILL_LOCK_ID
		});
		lockClient.release();
		process.exit(0);
	}

	const workerId = `${hostname()}:${process.pid}`;
	const concurrency = env.backfill.workerConcurrency;
	log('info', 'worker.started', {
		workerId,
		concurrency,
		lockId: BACKFILL_LOCK_ID
	});

	const abortController = new AbortController();
	let shuttingDown = false;
	const shutdown = (signal: string) => {
		if (shuttingDown) return;
		shuttingDown = true;
		log('info', 'worker.shutdown', { signal });
		abortController.abort();
	};
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));

	try {
		await workerLoop({
			workerId,
			concurrency,
			abortSignal: abortController.signal,
			executor: lockClient
		});
	} finally {
		try {
			await lockClient.query('SELECT pg_advisory_unlock($1)', [BACKFILL_LOCK_ID]);
		} catch {
			// Connection may already be gone during shutdown; ignore.
		}
		lockClient.release();
		log('info', 'worker.stopped', { workerId });
	}
}

const isEntrypoint = (() => {
	const argv1 = process.argv[1];
	if (!argv1) return false;
	const here = fileURLToPath(import.meta.url);
	return path.resolve(argv1) === path.resolve(here);
})();

if (isEntrypoint) {
	main().catch((err: unknown) => {
		log('error', 'worker.fatal', {
			message: err instanceof Error ? err.message : String(err)
		});
		process.exit(1);
	});
}
