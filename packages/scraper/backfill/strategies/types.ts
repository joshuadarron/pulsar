import type { ScrapedItem } from '@pulsar/shared/types';

/**
 * Inputs given to a backfill strategy by the worker. Strategies are pure
 * functions: they fetch from the upstream source, return ScrapedItems, and do
 * not write to the database. The worker is responsible for dedup + INSERT.
 */
export type StrategyContext = {
	sourceName: string;
	windowStart: Date;
	windowEnd: Date;
	backfillRunId: string;
	signal?: AbortSignal;
};

/**
 * Strategy output. `items` are emitted ScrapedItems with `sourceOrigin` and
 * `backfillRunId` set. `errors` collects non-fatal per-entry failures so the
 * worker can persist a partial-success summary on the backfill_run row.
 */
export type StrategyResult = {
	items: ScrapedItem[];
	errors: string[];
};

export type Strategy = (ctx: StrategyContext) => Promise<StrategyResult>;
