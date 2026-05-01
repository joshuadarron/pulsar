import { query } from '@pulsar/shared/db/postgres';
import { type NextRequest, NextResponse } from 'next/server';

interface SnapshotRow {
	period: string;
	computed_at: string;
	entity_importance: GraphSnapshotEntityShape[];
}

interface GraphSnapshotEntityShape {
	name: string;
	type?: string;
	pagerank_score: number;
	pagerank_rank?: number;
	mention_count?: number;
}

interface SeriesPoint {
	period: string;
	centrality: number;
	mentions: number;
}

interface EntitySeries {
	entityName: string;
	points: SeriesPoint[];
}

interface EntityCentralityResponse {
	meta: {
		currentPeriodEnd: string;
		periodKind: 'month';
		periods: number;
		sparse: boolean;
	};
	series: EntitySeries[];
}

const DEFAULT_PERIODS = 12;
const DEFAULT_TOP = 5;
const MAX_PERIODS = 60;
const MAX_TOP = 50;

/**
 * Parse a positive integer query param, falling back to `fallback` for missing
 * or invalid values. Caps at `max` to keep query cost bounded.
 */
function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.min(parsed, max);
}

/**
 * GET /api/charts/entity-centrality
 *
 * Returns a monthly time series of pagerank centrality and mention counts for
 * the top N entities by current-period centrality, walking backward from the
 * most recent `graph_snapshots` row.
 *
 * The data source is `graph_snapshots.entity_importance` JSONB. For each
 * calendar month within the look-back window we use the most recent snapshot
 * computed in that month (a "month bucket"). If no snapshot exists for a
 * given entity in a given month, we emit `centrality: 0, mentions: 0` for
 * that point.
 *
 * Query params:
 *   periods (default 12, max 60): number of backward monthly buckets to return.
 *                                 Buckets without snapshots are dropped, so the
 *                                 returned `meta.periods` may be smaller than
 *                                 requested when historical data is sparse.
 *   top     (default 5,  max 50): number of top entities to track, ranked by
 *                                 pagerank_score in the most recent snapshot.
 *
 * Empty result shape: `{ meta: { ..., sparse: true }, series: [] }`.
 * Never throws on sparse data.
 *
 * Auth: protected by middleware (matcher in packages/web/middleware.ts).
 *
 * Note: we deliberately use Postgres (`graph_snapshots` JSONB) rather than
 * Neo4j here. Neo4j currently holds only the live graph state, not historical
 * snapshots; the snapshots table is the source of truth for time-series.
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const requestedPeriods = parsePositiveInt(
		searchParams.get('periods'),
		DEFAULT_PERIODS,
		MAX_PERIODS
	);
	const top = parsePositiveInt(searchParams.get('top'), DEFAULT_TOP, MAX_TOP);

	const currentPeriodEnd = new Date();

	// Walk back `requestedPeriods` months from the current month. We compute
	// the cutoff in UTC so monthly buckets line up with `to_char(... 'YYYY-MM')`
	// in Postgres.
	const cutoff = new Date(
		Date.UTC(
			currentPeriodEnd.getUTCFullYear(),
			currentPeriodEnd.getUTCMonth() - (requestedPeriods - 1),
			1,
			0,
			0,
			0
		)
	);

	// One row per month: the most recent snapshot computed within that month.
	// `entity_importance` is JSONB; we cast to text and parse client-side to
	// avoid pg's type-coercion edge cases on JSONB arrays.
	const snapshotsResult = await query<SnapshotRow>(
		`SELECT DISTINCT ON (to_char(computed_at AT TIME ZONE 'UTC', 'YYYY-MM'))
			to_char(computed_at AT TIME ZONE 'UTC', 'YYYY-MM') AS period,
			computed_at,
			entity_importance
		 FROM graph_snapshots
		 WHERE computed_at >= $1
		 ORDER BY to_char(computed_at AT TIME ZONE 'UTC', 'YYYY-MM') DESC, computed_at DESC`,
		[cutoff.toISOString()]
	);

	const snapshots = snapshotsResult.rows;

	if (snapshots.length === 0) {
		const empty: EntityCentralityResponse = {
			meta: {
				currentPeriodEnd: currentPeriodEnd.toISOString(),
				periodKind: 'month',
				periods: 0,
				sparse: true
			},
			series: []
		};
		return NextResponse.json(empty);
	}

	// Snapshots come back DESC; the first row is the current period. Use it to
	// pick the top-N entities.
	const currentSnapshot = snapshots[0];
	const currentEntities = Array.isArray(currentSnapshot.entity_importance)
		? currentSnapshot.entity_importance
		: [];

	const topEntityNames = [...currentEntities]
		.sort((a, b) => (b.pagerank_score ?? 0) - (a.pagerank_score ?? 0))
		.slice(0, top)
		.map((e) => e.name);

	if (topEntityNames.length === 0) {
		const empty: EntityCentralityResponse = {
			meta: {
				currentPeriodEnd: currentPeriodEnd.toISOString(),
				periodKind: 'month',
				periods: snapshots.length,
				sparse: snapshots.length < requestedPeriods
			},
			series: []
		};
		return NextResponse.json(empty);
	}

	// Index snapshots by period for O(1) lookup, then build series ascending
	// by period. Periods with no snapshot are simply absent from the series
	// (we do not synthesize zero-value points to avoid implying "no mentions"
	// when we mean "no data").
	const byPeriod = new Map<string, GraphSnapshotEntityShape[]>();
	for (const row of snapshots) {
		byPeriod.set(row.period, Array.isArray(row.entity_importance) ? row.entity_importance : []);
	}

	const orderedPeriods = [...byPeriod.keys()].sort();

	const series: EntitySeries[] = topEntityNames.map((entityName) => {
		const points: SeriesPoint[] = [];
		for (const period of orderedPeriods) {
			const entities = byPeriod.get(period) ?? [];
			const found = entities.find((e) => e.name === entityName);
			if (!found) continue;
			points.push({
				period,
				centrality: typeof found.pagerank_score === 'number' ? found.pagerank_score : 0,
				mentions: typeof found.mention_count === 'number' ? found.mention_count : 0
			});
		}
		return { entityName, points };
	});

	const response: EntityCentralityResponse = {
		meta: {
			currentPeriodEnd: currentPeriodEnd.toISOString(),
			periodKind: 'month',
			periods: orderedPeriods.length,
			sparse: orderedPeriods.length < requestedPeriods
		},
		series
	};

	return NextResponse.json(response);
}
