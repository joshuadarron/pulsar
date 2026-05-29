import { env } from '@pulsar/shared/config/env';

import type { DbExecutor } from '../dedup.js';
import { COVERAGE_WINDOW_START, enqueueBackfill, monthsMissingCoverage } from './queue.js';
import { BACKFILL_PLATFORMS } from './source-platforms.js';

/** Strategy name recorded on backfill_jobs for month-coverage enqueues. */
const MONTH_FILL_STRATEGY = 'month-fill';

/** Earliest month-fill window start. Kept as a named export for callers
 * (CLI, tests) that need to align with the auto-enqueue window. */
export const FIRST_DEPLOY_FROM = COVERAGE_WINDOW_START;

export type EnqueueResult = {
	enqueued: string[];
	skipped: string[];
};

/**
 * For each known backfill adapter, find the most recent month in the coverage
 * window that has fewer than `MONTH_COVERAGE_THRESHOLD` rows and enqueue a
 * month-fill job for it. One job per adapter per tick so the worker queue
 * stays bounded — subsequent ticks walk older months.
 *
 * Replaces the previous total-rows gate (`maybeAutoEnqueue`) which masked
 * historical gaps for platforms that had plenty of recent live data.
 * No-ops when `env.backfill.enabled` is false.
 */
export async function enqueueMonthlyCoverage(executor: DbExecutor): Promise<EnqueueResult> {
	if (!env.backfill.enabled) {
		return { enqueued: [], skipped: ['feature flag off'] };
	}

	const enqueued: string[] = [];
	const skipped: string[] = [];

	for (const adapter of Object.keys(BACKFILL_PLATFORMS)) {
		const missing = await monthsMissingCoverage(executor, adapter);
		if (missing.length === 0) {
			skipped.push(adapter);
			continue;
		}
		const monthStart = missing[0];
		const monthEnd = addOneMonth(monthStart);
		try {
			await enqueueBackfill(executor, adapter, monthStart, monthEnd, MONTH_FILL_STRATEGY);
			enqueued.push(`${adapter}@${monthStart.toISOString().slice(0, 7)}`);
		} catch (err) {
			skipped.push(`${adapter} (enqueue failed: ${err instanceof Error ? err.message : err})`);
		}
	}

	return { enqueued, skipped };
}

function addOneMonth(d: Date): Date {
	const next = new Date(d);
	next.setUTCMonth(next.getUTCMonth() + 1);
	return next;
}
