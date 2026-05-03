import { enrichEntitiesWithHistory, fetchEntityHistory } from '@pulsar/scraper/analytics';
import type { EntityHistoryQuery } from '@pulsar/scraper/analytics';
import type { EntityWithHistory, GraphSnapshotEntity } from '@pulsar/shared/types';

import type { IntelligenceEntity, IntelligenceWindow } from '../types.js';
import type { SnapshotResolution } from './snapshot.js';

const DEFAULT_TOP_N = 20;
const HISTORY_PERIODS = 12;

export type LoadEntitiesOptions = {
	topN?: number;
	includeHistory?: boolean;
	/** Test seam for the history fetcher. Defaults to `fetchEntityHistory`. */
	historyFetcher?: (
		query: EntityHistoryQuery
	) => Promise<ReturnType<typeof fetchEntityHistory> extends Promise<infer R> ? R : never>;
	/** Optional warning sink. Defaults to silent. */
	warn?: (message: string) => void | Promise<void>;
};

/**
 * Pull entity rows out of the snapshot's `entityImportance` JSONB and
 * optionally enrich them with historical centrality + mention counts.
 *
 * History enrichment is soft-fail: if the fetcher throws, we return the
 * top-N entities without `history` so the caller still has usable data.
 *
 * @param window  The intelligence window the snapshot is anchored to. Used
 *                as the anchor for history bucketing.
 * @param snapshot The resolved snapshot whose `entityImportance` array we read.
 * @param opts    `topN` (default 20), `includeHistory` (default false).
 */
export async function loadEntities(
	window: IntelligenceWindow,
	snapshot: SnapshotResolution,
	opts: LoadEntitiesOptions = {}
): Promise<IntelligenceEntity[]> {
	const topN = opts.topN ?? DEFAULT_TOP_N;
	if (topN <= 0) return [];

	const importance = snapshot.snapshot.entityImportance;
	const top: GraphSnapshotEntity[] = importance.slice(0, topN);

	if (top.length === 0) return [];

	if (!opts.includeHistory) {
		return top.map(toIntelligenceEntity);
	}

	const fetcher = opts.historyFetcher ?? fetchEntityHistory;
	const enriched: EntityWithHistory[] = await enrichEntitiesWithHistory(top, fetcher, {
		currentPeriodEnd: window.end,
		periods: HISTORY_PERIODS,
		periodKind: 'month',
		warn: opts.warn
	});
	return enriched.map(toIntelligenceEntity);
}

function toIntelligenceEntity(entity: EntityWithHistory): IntelligenceEntity {
	return {
		name: entity.name,
		type: entity.type,
		pagerankScore: entity.pagerank_score,
		pagerankRank: entity.pagerank_rank,
		mentionCount: entity.mention_count,
		...(entity.history ? { history: entity.history } : {})
	};
}
