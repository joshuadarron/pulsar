import type { EntityWithHistory, GraphSnapshotEntity } from '@pulsar/shared/types';

import type { EntityHistory, EntityHistoryQuery } from './historical-centrality.js';

/**
 * Logger seam compatible with `console` and the `logRun` callsites in the
 * pipeline. We only ever call `warn` here.
 */
type WarnLogger = (message: string) => void | Promise<void>;

/**
 * Fetcher contract: given a query, return a list of `EntityHistory` records.
 * Production wiring uses `fetchEntityHistory`; tests pass a stub.
 */
export type EntityHistoryFetcher = (query: EntityHistoryQuery) => Promise<EntityHistory[]>;

export type EnrichOptions = {
	/** Anchor for the windowing (typically `now()` at pipeline start). */
	currentPeriodEnd: Date;
	/** Number of backward periods (e.g. 12 monthly buckets, or 3 yearly). */
	periods: number;
	/** Bucket granularity. */
	periodKind: 'month' | 'year';
	/** Optional warning sink. Defaults to a no-op (silent). */
	warn?: WarnLogger;
};

/**
 * Merge historical context into the top-N current-period entities. If the
 * fetcher throws (Neo4j unreachable, Postgres down, etc.) the function
 * returns the entities untouched so the pipeline can still produce a report.
 *
 * Entities for which the fetcher returned no record receive no `history`
 * field, matching the optional shape of `EntityWithHistory`.
 *
 * @param entities Top-N entities by current-period centrality.
 * @param fetcher Function that fetches `EntityHistory[]` given a query.
 * @param options Window definition + warning sink.
 * @return Entities with `history` attached where available.
 */
export async function enrichEntitiesWithHistory(
	entities: GraphSnapshotEntity[],
	fetcher: EntityHistoryFetcher,
	options: EnrichOptions
): Promise<EntityWithHistory[]> {
	if (entities.length === 0) return [];

	const entityNames = entities.map((e) => e.name);

	let histories: EntityHistory[];
	try {
		histories = await fetcher({
			entityNames,
			currentPeriodEnd: options.currentPeriodEnd,
			periods: options.periods,
			periodKind: options.periodKind
		});
	} catch (err) {
		const warn = options.warn;
		if (warn) await warn(`enrichEntitiesWithHistory: fetcher failed (${String(err)})`);
		return entities.map((e) => ({ ...e }));
	}

	const byName = new Map<string, EntityHistory>();
	for (const h of histories) byName.set(h.entityName, h);

	return entities.map((entity) => {
		const h = byName.get(entity.name);
		if (!h) return { ...entity };
		return {
			...entity,
			history: {
				twelveMonthDelta: h.twelveMonthDelta,
				yoyDelta: h.yoyDelta,
				trajectory: h.trajectory
			}
		};
	});
}
