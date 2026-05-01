import { getSession } from '@pulsar/shared/db/neo4j';
import { query as pgQuery } from '@pulsar/shared/db/postgres';
import type { GraphSnapshotEntity, Trajectory } from '@pulsar/shared/types';

import { compute12MonthDelta, computeMultiYearTrajectory, computeYoYDelta } from './deltas.js';

export type PeriodKind = 'month' | 'year';

export type EntityHistoryQuery = {
	/** Top-N entity names to fetch history for. */
	entityNames: string[];
	/** Anchor for the windowing. The current period contains this date. */
	currentPeriodEnd: Date;
	/** How many backward periods to fetch (inclusive of the current period). */
	periods: number;
	/** Whether each period is a calendar month or a calendar year. */
	periodKind: PeriodKind;
};

export type EntityHistory = {
	entityName: string;
	twelveMonthDelta: number;
	yoyDelta: number;
	trajectory: Trajectory;
};

/**
 * Minimal Neo4j session shape we depend on. Lets tests inject a fake without
 * pulling in `neo4j-driver` typings.
 */
export type Neo4jLike = {
	run: (
		cypher: string,
		params?: Record<string, unknown>
	) => Promise<{ records: Array<{ get: (key: string) => unknown }> }>;
	close: () => Promise<void>;
};

/** Minimal Postgres executor shape. */
export type PgLike = (
	sql: string,
	params?: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;

/**
 * Test seam. The default fetcher uses the production `getSession` and `query`
 * helpers; tests pass their own factory + executor.
 */
export type HistoryDeps = {
	getSession: () => Neo4jLike;
	pgQuery: PgLike;
};

const DEFAULT_DEPS: HistoryDeps = {
	getSession: () => getSession() as unknown as Neo4jLike,
	pgQuery: async (sql, params) => {
		const result = await pgQuery(sql, params);
		return {
			rows: result.rows as unknown as Array<Record<string, unknown>>,
			rowCount: result.rowCount
		};
	}
};

/**
 * Format a JS Date into a period label. Months use ISO "YYYY-MM"; years use
 * "YYYY". UTC is the only timezone we care about for analytics labels.
 */
export function periodLabel(date: Date, kind: PeriodKind): string {
	const year = date.getUTCFullYear();
	if (kind === 'year') return String(year);
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	return `${year}-${month}`;
}

/**
 * Compute the inclusive [start, end) bounds of the period containing `date`.
 * Months: [first of month, first of next month). Years: [Jan 1, next Jan 1).
 */
export function periodBounds(date: Date, kind: PeriodKind): { start: Date; end: Date } {
	const year = date.getUTCFullYear();
	if (kind === 'year') {
		return {
			start: new Date(Date.UTC(year, 0, 1)),
			end: new Date(Date.UTC(year + 1, 0, 1))
		};
	}
	const month = date.getUTCMonth();
	return {
		start: new Date(Date.UTC(year, month, 1)),
		end: new Date(Date.UTC(year, month + 1, 1))
	};
}

/**
 * Walk `periods` periods backward from the bucket containing `anchor`. Returns
 * the list of period buckets in ascending chronological order.
 */
export function buildPeriodWindows(
	anchor: Date,
	periods: number,
	kind: PeriodKind
): Array<{ label: string; start: Date; end: Date }> {
	const windows: Array<{ label: string; start: Date; end: Date }> = [];
	const anchorBounds = periodBounds(anchor, kind);
	for (let i = periods - 1; i >= 0; i--) {
		const refDate =
			kind === 'year'
				? new Date(Date.UTC(anchorBounds.start.getUTCFullYear() - i, 0, 1))
				: new Date(
						Date.UTC(anchorBounds.start.getUTCFullYear(), anchorBounds.start.getUTCMonth() - i, 1)
					);
		const bounds = periodBounds(refDate, kind);
		windows.push({ label: periodLabel(refDate, kind), ...bounds });
	}
	return windows;
}

function neoToNum(value: unknown): number {
	if (typeof value === 'object' && value !== null && 'toNumber' in value) {
		return (value as { toNumber(): number }).toNumber();
	}
	return Number(value ?? 0);
}

/**
 * Run a single Cypher query that buckets `Article -[:MENTIONS]-> Entity` rows
 * by period for the requested entities. Returns
 * `Map<entityName, Map<periodLabel, mentionCount>>`.
 */
async function fetchMentionsByPeriod(
	session: Neo4jLike,
	entityNames: string[],
	windows: Array<{ label: string; start: Date; end: Date }>,
	kind: PeriodKind
): Promise<Map<string, Map<string, number>>> {
	const out = new Map<string, Map<string, number>>();
	for (const name of entityNames) out.set(name, new Map());

	if (entityNames.length === 0 || windows.length === 0) return out;

	const earliest = windows[0].start.toISOString();
	const latest = windows[windows.length - 1].end.toISOString();

	// One windowed query, bucketed in TS afterward. The Cypher returns
	// (entity, publishedAt) rows in the overall window; we count into the
	// right bucket on the application side. This avoids per-period round
	// trips and keeps the Cypher simple.
	const result = await session.run(
		`MATCH (e:Entity)<-[:MENTIONS]-(a:Article)
		 WHERE e.name IN $names
		   AND a.publishedAt >= datetime($earliest)
		   AND a.publishedAt < datetime($latest)
		 RETURN e.name AS name, a.publishedAt AS publishedAt`,
		{ names: entityNames, earliest, latest }
	);

	for (const record of result.records) {
		const name = record.get('name') as string;
		const publishedRaw = record.get('publishedAt');
		const published = parseNeo4jDateTime(publishedRaw);
		if (!published) continue;
		const label = periodLabel(published, kind);
		const bucket = out.get(name);
		if (!bucket) continue;
		bucket.set(label, (bucket.get(label) ?? 0) + 1);
	}

	return out;
}

/**
 * Best-effort conversion of a Neo4j datetime value into a JS Date. Accepts
 * driver-typed datetime objects (with toString), strings, and Date
 * instances.
 */
function parseNeo4jDateTime(value: unknown): Date | null {
	if (!value) return null;
	if (value instanceof Date) return value;
	if (typeof value === 'string') {
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	if (typeof value === 'object' && 'toString' in value) {
		const d = new Date(String(value));
		return Number.isNaN(d.getTime()) ? null : d;
	}
	return null;
}

/**
 * Pull historical centrality (pagerank score) for each requested entity from
 * the `graph_snapshots` table. Returns
 * `Map<entityName, Map<periodLabel, pagerankScore>>` using the latest snapshot
 * within each window.
 *
 * Uses the existing Postgres-side snapshots rather than recomputing PageRank
 * per period in Neo4j. Faster, leverages already-persisted runs.
 */
async function fetchCentralityFromSnapshots(
	pgQueryFn: PgLike,
	entityNames: string[],
	windows: Array<{ label: string; start: Date; end: Date }>,
	kind: PeriodKind
): Promise<Map<string, Map<string, number>>> {
	const out = new Map<string, Map<string, number>>();
	for (const name of entityNames) out.set(name, new Map());

	if (entityNames.length === 0 || windows.length === 0) return out;

	const earliest = windows[0].start;
	const latest = windows[windows.length - 1].end;

	const result = await pgQueryFn(
		`SELECT computed_at, entity_importance
		 FROM graph_snapshots
		 WHERE computed_at >= $1 AND computed_at < $2
		 ORDER BY computed_at ASC`,
		[earliest, latest]
	);

	const nameSet = new Set(entityNames);
	for (const row of result.rows) {
		const computedAtRaw = row.computed_at;
		const computedAt =
			computedAtRaw instanceof Date ? computedAtRaw : new Date(String(computedAtRaw));
		if (Number.isNaN(computedAt.getTime())) continue;
		const label = periodLabel(computedAt, kind);
		// Within a single period bucket, later snapshots overwrite earlier ones.
		// `ORDER BY computed_at ASC` above guarantees the last one wins.
		const importance = Array.isArray(row.entity_importance)
			? (row.entity_importance as GraphSnapshotEntity[])
			: [];
		for (const entry of importance) {
			if (!nameSet.has(entry.name)) continue;
			const bucket = out.get(entry.name);
			if (!bucket) continue;
			bucket.set(label, entry.pagerank_score);
		}
	}

	return out;
}

/**
 * Fetch historical context for the named entities. Combines:
 *   - mention counts per period (windowed Cypher over `Article -[:MENTIONS]-> Entity`)
 *   - centrality per period (latest `graph_snapshots.entity_importance` row in the window)
 *
 * Returns one `EntityHistory` per requested name. Sparse data is reflected
 * with zero deltas and short trajectories rather than thrown errors.
 *
 * @param query Window definition + entity names.
 * @param deps Optional dependency injection seam (used by tests).
 */
export async function fetchEntityHistory(
	query: EntityHistoryQuery,
	deps: HistoryDeps = DEFAULT_DEPS
): Promise<EntityHistory[]> {
	const { entityNames, currentPeriodEnd, periods, periodKind } = query;
	if (entityNames.length === 0 || periods <= 0) return [];

	const windows = buildPeriodWindows(currentPeriodEnd, periods, periodKind);
	const session = deps.getSession();

	let mentionsByEntity: Map<string, Map<string, number>>;
	try {
		mentionsByEntity = await fetchMentionsByPeriod(session, entityNames, windows, periodKind);
	} finally {
		await session.close();
	}

	const centralityByEntity = await fetchCentralityFromSnapshots(
		deps.pgQuery,
		entityNames,
		windows,
		periodKind
	);

	return entityNames.map((name) =>
		buildEntityHistory(name, windows, mentionsByEntity, centralityByEntity)
	);
}

function buildEntityHistory(
	name: string,
	windows: Array<{ label: string; start: Date; end: Date }>,
	mentionsByEntity: Map<string, Map<string, number>>,
	centralityByEntity: Map<string, Map<string, number>>
): EntityHistory {
	const mentions = mentionsByEntity.get(name) ?? new Map<string, number>();
	const centrality = centralityByEntity.get(name) ?? new Map<string, number>();

	const periodMentions: Record<string, number> = {};
	const periodCentrality: Record<string, number> = {};
	for (const w of windows) {
		periodMentions[w.label] = mentions.get(w.label) ?? 0;
		periodCentrality[w.label] = centrality.get(w.label) ?? 0;
	}

	const labels = windows.map((w) => w.label);
	const currentLabel = labels[labels.length - 1];
	const currentMentions = periodMentions[currentLabel] ?? 0;

	// twelveMonthDelta: compare current period to the same-calendar-slot period
	// 12 months earlier (12 buckets back for monthly windows, 1 bucket back for
	// yearly windows). Returns 0 when the window does not extend that far.
	const twelveBackOffset = windows.length > 0 && labels[0].length === 4 ? 1 : 12;
	const twelveBack = labels[labels.length - 1 - twelveBackOffset] ?? null;

	const twelveMonthDelta = twelveBack
		? compute12MonthDelta(currentMentions, periodMentions[twelveBack] ?? 0)
		: 0;

	// yoyDelta: aggregate current full calendar year vs prior full calendar
	// year by summing the bucket mentions whose labels share the same year.
	const yoyDelta = computeYoYFromBuckets(periodMentions, currentLabel);

	const trajectory = computeMultiYearTrajectory(name, periodMentions, periodCentrality);

	return { entityName: name, twelveMonthDelta, yoyDelta, trajectory };
}

/**
 * Aggregate bucket counts into the calendar year of `currentLabel` and the
 * calendar year before it, then compute the YoY delta. Works for both
 * monthly buckets ("YYYY-MM") and yearly buckets ("YYYY").
 */
function computeYoYFromBuckets(
	periodMentions: Record<string, number>,
	currentLabel: string
): number {
	const currentYear = currentLabel.slice(0, 4);
	const previousYear = String(Number.parseInt(currentYear, 10) - 1);

	let currentYearTotal = 0;
	let previousYearTotal = 0;
	for (const [label, count] of Object.entries(periodMentions)) {
		if (label.startsWith(currentYear)) currentYearTotal += count;
		if (label.startsWith(previousYear)) previousYearTotal += count;
	}
	return computeYoYDelta(currentYearTotal, previousYearTotal);
}
