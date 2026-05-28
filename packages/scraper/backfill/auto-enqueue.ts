import { env } from '@pulsar/shared/config/env';

import type { DbExecutor } from '../dedup.js';
import { articleCountsByAdapter, enqueueBackfill } from './queue.js';

/**
 * Sources whose article count falls below this threshold are eligible for an
 * auto-enqueue full backfill on first deploy.
 */
export const FIRST_DEPLOY_THRESHOLD = 30;

/** Earliest backfill window start: ChatGPT public release. */
export const FIRST_DEPLOY_FROM = new Date('2022-12-01T00:00:00Z');

/** Strategy name recorded on the backfill_jobs row for auto-enqueued runs. */
const FIRST_DEPLOY_STRATEGY = 'first-deploy';

/**
 * A `complete` run with zero ingested items is treated as "covered" for this
 * many days after it completed. After the cooldown elapses, the source is
 * eligible for re-enqueue so a transient upstream issue (Wayback empty,
 * rate-limit storm, broken parser) does not freeze the source forever once
 * the bug is fixed.
 */
const EMPTY_COMPLETE_COOLDOWN_DAYS = 7;

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

	const counts = await articleCountsByAdapter(executor);
	const enqueued: string[] = [];
	const skipped: string[] = [];

	const sparseAdapters = Object.entries(counts).filter(
		([, count]) => count < FIRST_DEPLOY_THRESHOLD
	);

	const now = new Date();
	for (const [adapter] of sparseAdapters) {
		const covered = await isAlreadyCovered(executor, adapter);
		if (covered) {
			skipped.push(adapter);
			continue;
		}
		await enqueueBackfill(executor, adapter, FIRST_DEPLOY_FROM, now, FIRST_DEPLOY_STRATEGY);
		enqueued.push(adapter);
	}

	return { enqueued, skipped };
}

/**
 * True if a non-failed backfill_runs row already exists for this source whose
 * window spans (window_start <= FIRST_DEPLOY_FROM) AND (window_end >= FIRST_DEPLOY_FROM).
 *
 * Failed runs are excluded so they don't shield against retries. Complete runs
 * that ingested zero items are excluded ONLY after the empty-complete cooldown
 * has elapsed — that gives operators a window to notice a genuinely-empty
 * source without masking real upstream regressions, while still letting the
 * system self-heal long-term if a strategy bug is later fixed.
 */
async function isAlreadyCovered(executor: DbExecutor, source: string): Promise<boolean> {
	const result = await executor.query<{ id: string }>(
		`SELECT id FROM backfill_runs
     WHERE source_name = $1
       AND status <> 'failed'
       AND window_start <= $2
       AND window_end >= $2
       AND NOT (
         status = 'complete'
         AND articles_ingested = 0
         AND completed_at < now() - ($3::text || ' days')::interval
       )
     LIMIT 1`,
		[source, FIRST_DEPLOY_FROM, String(EMPTY_COMPLETE_COOLDOWN_DAYS)]
	);
	return (result.rowCount ?? 0) > 0;
}
