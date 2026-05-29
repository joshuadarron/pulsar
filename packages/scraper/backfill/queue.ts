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
 * Retained as a diagnostic surface. The auto-enqueue path uses
 * `monthsMissingCoverage` instead because total-row count masks historical
 * gaps (a platform with 3,000 live rows in 2 months looks healthy while 40
 * prior months are empty).
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

/**
 * Earliest month included in the per-month coverage check. Matches the live
 * scraper's start-of-history (ChatGPT public release).
 */
export const COVERAGE_WINDOW_START = new Date('2022-12-01T00:00:00Z');

/**
 * A `(adapter, month)` pair is "covered" when the live and backfilled rows for
 * that month total at least this many. Set low because Wayback / archive feeds
 * are sparse for some platforms; a handful of articles per month is a
 * meaningful signal that the strategy did *something*.
 */
export const MONTH_COVERAGE_THRESHOLD = 5;

/**
 * Per-adapter cap on month-fill jobs that can be queued or claimed at once.
 * The auto-enqueue path checks this before adding work for an adapter so a
 * burst of missing months does not flood the worker queue or burn Wayback
 * rate limits.
 */
export const MAX_INFLIGHT_PER_ADAPTER = 1;

/** Days an attempted month is shielded from re-enqueue. */
export const MONTH_RETRY_COOLDOWN_DAYS = 7;

/**
 * Hard ceiling on `backfill_runs` rows per `(source, window_start)` tuple.
 * Once this many attempts exist for a given month, the auto-enqueue path
 * stops trying — Wayback / upstream archives are genuinely empty for that
 * month and re-running burns rate-limit budget for no gain. The diagnostic
 * trail (errors, warnings, articles_ingested) remains in `backfill_runs`.
 */
export const MAX_MONTH_ATTEMPTS = 2;

/**
 * Count of in-flight month-fill jobs for an adapter (queued or claimed).
 * Used by `enqueueMonthlyCoverage` to enforce per-adapter concurrency.
 */
export async function inflightCount(executor: DbExecutor, adapter: string): Promise<number> {
	const result = await executor.query<{ count: string }>(
		`SELECT COUNT(*)::text AS count FROM backfill_jobs
     WHERE source_name = $1
       AND strategy = 'month-fill'
       AND status IN ('queued', 'claimed')`,
		[adapter]
	);
	return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Total `backfill_runs` rows ever created for this `(adapter, monthStart)`.
 * Used by `enqueueMonthlyCoverage` to retire a month after `MAX_MONTH_ATTEMPTS`
 * — Wayback empties stop consuming queue slots forever, the diagnostic stays
 * preserved in the failed/empty-complete rows.
 */
export async function monthAttemptCount(
	executor: DbExecutor,
	adapter: string,
	monthStart: Date
): Promise<number> {
	const result = await executor.query<{ count: string }>(
		`SELECT COUNT(*)::text AS count FROM backfill_runs
     WHERE source_name = $1 AND window_start = $2`,
		[adapter, monthStart]
	);
	return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * True if a `backfill_runs` row already exists for this `(adapter, monthStart)`
 * created within the cooldown window. Prevents a tick from re-enqueuing a
 * month that was just attempted, even if the previous attempt was empty.
 */
export async function monthAttemptedRecently(
	executor: DbExecutor,
	adapter: string,
	monthStart: Date,
	cooldownDays = MONTH_RETRY_COOLDOWN_DAYS
): Promise<boolean> {
	const result = await executor.query<{ id: string }>(
		`SELECT id FROM backfill_runs
     WHERE source_name = $1
       AND window_start = $2
       AND created_at > now() - ($3::text || ' days')::interval
     LIMIT 1`,
		[adapter, monthStart, String(cooldownDays)]
	);
	return (result.rowCount ?? 0) > 0;
}

/**
 * Months in `[COVERAGE_WINDOW_START, current month]` where the adapter has
 * fewer than `threshold` rows in `articles_raw`. Newest-first so the
 * auto-enqueue path prioritizes recent gaps over deep history.
 *
 * Counts live and backfilled rows together: the goal is overall coverage
 * per month, not "did we backfill this month" — a month already populated
 * by the live scraper should not consume a backfill slot.
 */
export async function monthsMissingCoverage(
	executor: DbExecutor,
	adapter: string,
	threshold = MONTH_COVERAGE_THRESHOLD
): Promise<Date[]> {
	const platforms = BACKFILL_PLATFORMS[adapter];
	if (!platforms || platforms.length === 0) return [];

	const result = await executor.query<{ month_start: Date }>(
		`WITH months AS (
       SELECT generate_series(
         $1::timestamptz,
         date_trunc('month', now() AT TIME ZONE 'UTC'),
         interval '1 month'
       ) AS month_start
     ),
     covered AS (
       SELECT date_trunc('month', (raw_payload->>'publishedAt')::timestamptz)
                AS month_start,
              COUNT(*) AS row_count
       FROM articles_raw
       WHERE raw_payload->>'sourcePlatform' = ANY($2::text[])
         AND (raw_payload->>'publishedAt')::timestamptz >= $1::timestamptz
       GROUP BY 1
     )
     SELECT m.month_start
     FROM months m
     LEFT JOIN covered c USING (month_start)
     WHERE COALESCE(c.row_count, 0) < $3
     ORDER BY m.month_start DESC`,
		[COVERAGE_WINDOW_START, platforms, threshold]
	);

	return result.rows.map((r) => new Date(r.month_start));
}

export type { BackfillJob, BackfillJobStatus, BackfillStatus };
