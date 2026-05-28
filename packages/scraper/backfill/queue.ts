import type { BackfillJob, BackfillJobStatus, BackfillStatus } from '@pulsar/shared/types';
import type { DbExecutor } from '../dedup.js';
import { BACKFILL_PLATFORMS } from './source-platforms.js';

export type ClaimedJob = BackfillJob;

type BackfillJobRow = {
	id: string;
	backfill_run_id: string | null;
	source_name: string;
	window_start: Date;
	window_end: Date;
	strategy: string;
	status: BackfillJobStatus;
	attempts: number;
	claimed_by: string | null;
	claimed_at: Date | null;
	completed_at: Date | null;
	error_message: string | null;
	created_at: Date;
};

function rowToJob(row: BackfillJobRow): BackfillJob {
	return {
		id: row.id,
		backfillRunId: row.backfill_run_id,
		sourceName: row.source_name,
		windowStart: row.window_start,
		windowEnd: row.window_end,
		strategy: row.strategy,
		status: row.status,
		attempts: row.attempts,
		claimedBy: row.claimed_by,
		claimedAt: row.claimed_at,
		completedAt: row.completed_at,
		errorMessage: row.error_message,
		createdAt: row.created_at
	};
}

/**
 * Atomically claim up to `limit` queued jobs. Uses `FOR UPDATE SKIP LOCKED`
 * inside the inner SELECT so two workers running this concurrently never
 * receive overlapping job IDs.
 *
 * `workerId` is for telemetry only (e.g. `${hostname}:${pid}`); it has no
 * impact on locking semantics.
 */
export async function claimJobs(
	executor: DbExecutor,
	workerId: string,
	limit: number
): Promise<ClaimedJob[]> {
	const result = await executor.query<BackfillJobRow>(
		`UPDATE backfill_jobs
     SET status = 'claimed', claimed_by = $1, claimed_at = now(), attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM backfill_jobs
       WHERE status = 'queued'
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     RETURNING *`,
		[workerId, limit]
	);
	return result.rows.map(rowToJob);
}

export type CompleteJobDiagnostics = {
	errors?: string[];
	warnings?: string[];
};

/**
 * Mark a claimed job as complete with the count of articles ingested. Any
 * non-fatal errors or diagnostic warnings the strategy collected are appended
 * to `backfill_runs.errors` so a "complete with 0 items" run is still
 * diagnosable from the DB without grepping worker logs. Errors are recorded
 * with severity "error" and warnings with severity "warning" so the row
 * shape reads back unambiguously.
 */
export async function completeJob(
	executor: DbExecutor,
	jobId: string,
	articlesIngested: number,
	diagnostics: CompleteJobDiagnostics = {}
): Promise<void> {
	await executor.query(
		`UPDATE backfill_jobs
     SET status = 'complete', completed_at = now()
     WHERE id = $1`,
		[jobId]
	);

	const entries: { severity: 'error' | 'warning'; message: string }[] = [];
	for (const message of diagnostics.errors ?? []) {
		entries.push({ severity: 'error', message });
	}
	for (const message of diagnostics.warnings ?? []) {
		entries.push({ severity: 'warning', message });
	}

	if (entries.length === 0) {
		await executor.query(
			`UPDATE backfill_runs
       SET articles_ingested = articles_ingested + $2,
           status = 'complete',
           completed_at = now()
       WHERE id = (SELECT backfill_run_id FROM backfill_jobs WHERE id = $1)`,
			[jobId, articlesIngested]
		);
		return;
	}

	await executor.query(
		`UPDATE backfill_runs
     SET articles_ingested = articles_ingested + $2,
         status = 'complete',
         completed_at = now(),
         errors = COALESCE(errors, '[]'::jsonb) || $3::jsonb
     WHERE id = (SELECT backfill_run_id FROM backfill_jobs WHERE id = $1)`,
		[jobId, articlesIngested, JSON.stringify(entries)]
	);
}

/**
 * Maximum number of times a single job will be attempted before being marked
 * terminally failed. Each `claimJobs` call increments `attempts`, so a job that
 * is retried twice will record three attempts in total before
 * `requeueRetriableFailures` stops promoting it.
 */
export const MAX_JOB_ATTEMPTS = 3;

/**
 * Mark a claimed job as failed. Increments `attempts` (already incremented at
 * claim time) is intentionally not re-incremented here; the failure is
 * recorded on the row that was already claimed.
 */
export async function failJob(executor: DbExecutor, jobId: string, error: Error): Promise<void> {
	await executor.query(
		`UPDATE backfill_jobs
     SET status = 'failed', completed_at = now(), error_message = $2
     WHERE id = $1`,
		[jobId, error.message]
	);
	await executor.query(
		`UPDATE backfill_runs
     SET status = 'failed',
         completed_at = now(),
         errors = COALESCE(errors, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('jobId', $1::text, 'message', $2::text))
     WHERE id = (SELECT backfill_run_id FROM backfill_jobs WHERE id = $1)`,
		[jobId, error.message]
	);
}

/**
 * Promote failed jobs whose attempt count is still below `maxAttempts` back to
 * `status='queued'` so the worker's next claim picks them up again. Clears
 * `claimed_by`/`claimed_at`/`completed_at`/`error_message` so the row is
 * indistinguishable from a fresh queued job. `attempts` is preserved so the
 * count keeps growing across retries and eventually crosses the threshold.
 *
 * The parent `backfill_runs.status` is left as 'failed' here; the eventual
 * `completeJob` flips it to 'complete' if/when the retry succeeds, which is
 * the same recovery path used by any re-enqueue.
 *
 * Returns the number of rows promoted. Safe to call on every poll: a no-op
 * when nothing is eligible.
 */
export async function requeueRetriableFailures(
	executor: DbExecutor,
	maxAttempts = MAX_JOB_ATTEMPTS
): Promise<number> {
	const result = await executor.query(
		`UPDATE backfill_jobs
     SET status = 'queued',
         claimed_by = NULL,
         claimed_at = NULL,
         completed_at = NULL,
         error_message = NULL
     WHERE status = 'failed' AND attempts < $1`,
		[maxAttempts]
	);
	return result.rowCount ?? 0;
}

/**
 * Enqueue a new backfill window. Creates a `backfill_runs` record and a
 * matching `backfill_jobs` row. Caller is responsible for transaction
 * lifecycle when atomicity across multiple enqueues is required.
 */
export async function enqueueBackfill(
	executor: DbExecutor,
	source: string,
	windowStart: Date,
	windowEnd: Date,
	strategy: string
): Promise<{ runId: string; jobId: string }> {
	const runResult = await executor.query<{ id: string }>(
		`INSERT INTO backfill_runs (source_name, window_start, window_end, status)
     VALUES ($1, $2, $3, 'queued')
     RETURNING id`,
		[source, windowStart, windowEnd]
	);
	const runId = runResult.rows[0].id;
	const jobResult = await executor.query<{ id: string }>(
		`INSERT INTO backfill_jobs (backfill_run_id, source_name, window_start, window_end, strategy)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
		[runId, source, windowStart, windowEnd, strategy]
	);
	return { runId, jobId: jobResult.rows[0].id };
}

/**
 * Per-adapter article counts. Returns one entry per known backfill adapter key
 * (the key used to look up a Strategy in `strategies/index.ts`), counting live
 * `articles_raw` rows whose `raw_payload->>'sourcePlatform'` matches the
 * adapter's platform list in `BACKFILL_PLATFORMS`.
 *
 * This is the source of truth for auto-enqueue's "sparse source" check. The
 * keys are adapter keys (e.g. `'hackernews'`), not display names (e.g.
 * `'Hacker News'`), so the values can be passed straight to `enqueueBackfill`
 * and the worker's `getStrategy()` resolver.
 */
export async function articleCountsByAdapter(
	executor: DbExecutor
): Promise<Record<string, number>> {
	const platformToAdapter: Record<string, string> = {};
	for (const [adapter, platforms] of Object.entries(BACKFILL_PLATFORMS)) {
		for (const platform of platforms) platformToAdapter[platform] = adapter;
	}
	const allPlatforms = Object.keys(platformToAdapter);

	const result = await executor.query<{ platform: string; count: string }>(
		`SELECT raw_payload->>'sourcePlatform' AS platform, COUNT(*)::text AS count
     FROM articles_raw
     WHERE raw_payload->>'sourcePlatform' = ANY($1::text[])
     GROUP BY raw_payload->>'sourcePlatform'`,
		[allPlatforms]
	);

	const out: Record<string, number> = {};
	for (const adapter of Object.keys(BACKFILL_PLATFORMS)) out[adapter] = 0;
	for (const row of result.rows) {
		const adapter = platformToAdapter[row.platform];
		if (!adapter) continue;
		out[adapter] = (out[adapter] ?? 0) + Number.parseInt(row.count, 10);
	}
	return out;
}

export type { BackfillJob, BackfillJobStatus, BackfillStatus };
