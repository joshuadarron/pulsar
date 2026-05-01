import type { BackfillJob, BackfillJobStatus, BackfillStatus } from '@pulsar/shared/types';
import type { DbExecutor } from '../dedup.js';

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

/** Mark a claimed job as complete with the count of articles ingested. */
export async function completeJob(
	executor: DbExecutor,
	jobId: string,
	articlesIngested: number
): Promise<void> {
	await executor.query(
		`UPDATE backfill_jobs
     SET status = 'complete', completed_at = now()
     WHERE id = $1`,
		[jobId]
	);
	await executor.query(
		`UPDATE backfill_runs
     SET articles_ingested = articles_ingested + $2,
         status = 'complete',
         completed_at = now()
     WHERE id = (SELECT backfill_run_id FROM backfill_jobs WHERE id = $1)`,
		[jobId, articlesIngested]
	);
}

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
 * Per-source article counts. Used by gap detection to decide whether to
 * auto-enqueue a full backfill for a sparse source.
 */
export async function articleCountsBySource(executor: DbExecutor): Promise<Record<string, number>> {
	const result = await executor.query<{ source_name: string; count: string }>(
		`SELECT source_name, COUNT(*)::text AS count
     FROM articles_raw
     GROUP BY source_name`
	);
	const out: Record<string, number> = {};
	for (const row of result.rows) {
		out[row.source_name] = Number.parseInt(row.count, 10);
	}
	return out;
}

export type { BackfillJob, BackfillJobStatus, BackfillStatus };
