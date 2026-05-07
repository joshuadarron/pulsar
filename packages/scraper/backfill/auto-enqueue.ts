import { env } from '@pulsar/shared/config/env';

import type { DbExecutor } from '../dedup.js';
import { articleCountsBySource, enqueueBackfill } from './queue.js';

/**
 * Sources whose article count falls below this threshold are eligible for an
 * auto-enqueue full backfill on first deploy.
 */
export const FIRST_DEPLOY_THRESHOLD = 30;

/** Earliest backfill window start: ChatGPT public release. */
export const FIRST_DEPLOY_FROM = new Date('2022-12-01T00:00:00Z');

/** Strategy name recorded on the backfill_jobs row for auto-enqueued runs. */
const FIRST_DEPLOY_STRATEGY = 'first-deploy';

export type AutoEnqueueResult = {
	enqueued: string[];
	skipped: string[];
};

/**
 * Idempotent auto-enqueue. For each source whose row count is below the
 * first-deploy threshold AND that does not already have a backfill_runs row
 * covering the full first-deploy window, enqueue a full backfill from
 * 2022-12-01 to now.
 *
 * No-ops when `env.backfill.enabled` is false. Safe to call on every scheduler
 * tick: existing coverage rows short-circuit duplicate enqueues.
 */
export async function maybeAutoEnqueue(executor: DbExecutor): Promise<AutoEnqueueResult> {
	if (!env.backfill.enabled) {
		return { enqueued: [], skipped: ['feature flag off'] };
	}

	const counts = await articleCountsBySource(executor);
	const enqueued: string[] = [];
	const skipped: string[] = [];

	const sparseSources = Object.entries(counts).filter(
		([, count]) => count < FIRST_DEPLOY_THRESHOLD
	);

	const now = new Date();
	for (const [source] of sparseSources) {
		const covered = await isAlreadyCovered(executor, source);
		if (covered) {
			skipped.push(source);
			continue;
		}
		await enqueueBackfill(executor, source, FIRST_DEPLOY_FROM, now, FIRST_DEPLOY_STRATEGY);
		enqueued.push(source);
	}

	return { enqueued, skipped };
}

/**
 * True if a non-failed backfill_runs row already exists for this source whose
 * window spans (window_start <= FIRST_DEPLOY_FROM) AND (window_end >= FIRST_DEPLOY_FROM).
 * Failed runs are intentionally excluded so they no longer act as a permanent
 * shield against retries. Queued, running, and complete runs all count as
 * covered (a complete run with zero ingested still represents a finished
 * attempt; rerunning it auto-magically would mask the problem). Operators
 * who want to retry a "complete with 0 items" run should delete the row.
 */
async function isAlreadyCovered(executor: DbExecutor, source: string): Promise<boolean> {
	const result = await executor.query<{ id: string }>(
		`SELECT id FROM backfill_runs
     WHERE source_name = $1
       AND status <> 'failed'
       AND window_start <= $2
       AND window_end >= $2
     LIMIT 1`,
		[source, FIRST_DEPLOY_FROM]
	);
	return (result.rowCount ?? 0) > 0;
}
