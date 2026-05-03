import { getSession } from '@pulsar/shared/db/neo4j';
import { query as pgQuery } from '@pulsar/shared/db/postgres';
import { logRun } from '@pulsar/shared/run-logger';
import type { GraphSnapshotCluster, GraphSnapshotEntity } from '@pulsar/shared/types';

import type { IntelligenceWindow } from '../types.js';

/**
 * Snapshot row plus where it came from. `cached` means we reused a row from
 * `graph_snapshots`; `recomputed` means we ran Louvain + PageRank for the
 * window and inserted a new row.
 */
export type SnapshotResolution = {
	snapshot: {
		id: string;
		topicClusters: GraphSnapshotCluster[];
		entityImportance: GraphSnapshotEntity[];
	};
	source: 'cached' | 'recomputed';
	computeMs?: number;
};

export type GetOrComputeSnapshotOptions = {
	window: IntelligenceWindow;
	preferredId?: string;
	forceRecompute?: boolean;
	/** Optional run id for the run_logs trail. */
	runId?: string;
};

/**
 * Minimal Postgres executor seam compatible with `@pulsar/shared/db/postgres`'s
 * `query`. Tests inject a stub here so we can exercise the decision tree
 * without a live database.
 */
export type PgQueryFn = <T = Record<string, unknown>>(
	sql: string,
	params?: unknown[]
) => Promise<{ rows: T[]; rowCount: number | null }>;

/**
 * Minimal Neo4j session shape used during recompute. Mirrors the surface of
 * `neo4j-driver`'s `Session` so production code can pass `getSession()` and
 * tests can pass a stub.
 */
export type Neo4jSessionLike = {
	run: (
		cypher: string,
		params?: Record<string, unknown>
	) => Promise<{ records: Array<{ get: (key: string) => unknown }> }>;
	close: () => Promise<void>;
};

export type SnapshotDeps = {
	pgQuery: PgQueryFn;
	getSession: () => Neo4jSessionLike;
	log?: (
		runId: string,
		level: 'info' | 'warn' | 'success' | 'error',
		stage: string,
		message: string
	) => Promise<void>;
	/** Sleep seam, in ms. Tests inject a no-op. */
	sleep?: (ms: number) => Promise<void>;
	/** Wall-clock seam. Tests can inject a deterministic clock. */
	now?: () => number;
};

const defaultPgQuery: PgQueryFn = async <T = Record<string, unknown>>(
	sql: string,
	params?: unknown[]
) => {
	const result = await pgQuery(sql, params);
	return {
		rows: result.rows as unknown as T[],
		rowCount: result.rowCount
	};
};

const DEFAULT_DEPS: SnapshotDeps = {
	pgQuery: defaultPgQuery,
	getSession: () => getSession() as unknown as Neo4jSessionLike,
	log: logRun,
	sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
	now: () => Date.now()
};

const ADVISORY_LOCK_NAMESPACE = 'context-builder:snapshot';
const LOCK_RETRY_INTERVAL_MS = 250;
const LOCK_TOTAL_TIMEOUT_MS = 30_000;

interface LouvainRow {
	communityId: number;
	name: string;
	trendScore: number;
}

interface PageRankRow {
	name: string;
	type: string;
	pagerank_score: number;
	mention_count: number;
}

interface SnapshotRow {
	id: string;
	topic_clusters: unknown;
	entity_importance: unknown;
	computed_at: Date | string;
}

/**
 * Resolve a graph snapshot for the requested window. The algorithm is:
 *
 *   1. If `preferredId` is set, fetch that row and return it.
 *   2. Else find the most recent snapshot whose `computed_at` is within the
 *      window. None? Recompute.
 *   3. Stale check: if any article was enriched after `computed_at` (within
 *      the window), or `forceRecompute` is true, recompute.
 *   4. Recompute path: acquire a Postgres advisory lock keyed by the window
 *      so concurrent callers do not duplicate the work, then run
 *      `gds.louvain.stream` + `gds.pageRank.stream` filtered to the window
 *      and persist a new row.
 *
 * Logging via `run_logs` happens iff a `runId` is supplied. Stage is always
 * `context`. Messages match the strings documented in PR 1b.
 */
export async function getOrComputeSnapshot(
	opts: GetOrComputeSnapshotOptions,
	deps: SnapshotDeps = DEFAULT_DEPS
): Promise<SnapshotResolution> {
	const merged: Required<SnapshotDeps> = {
		pgQuery: deps.pgQuery ?? DEFAULT_DEPS.pgQuery,
		getSession: deps.getSession ?? DEFAULT_DEPS.getSession,
		log: deps.log ?? DEFAULT_DEPS.log ?? (async () => {}),
		sleep: deps.sleep ?? DEFAULT_DEPS.sleep ?? (async () => {}),
		now: deps.now ?? DEFAULT_DEPS.now ?? Date.now
	};

	if (opts.preferredId) {
		const row = await fetchSnapshotById(merged.pgQuery, opts.preferredId);
		if (!row) throw new Error(`Snapshot not found: ${opts.preferredId}`);
		await maybeLog(
			merged,
			opts.runId,
			'info',
			`Reusing graph snapshot ${row.id} for window ${formatWindow(opts.window)}`
		);
		return {
			snapshot: toSnapshot(row),
			source: 'cached'
		};
	}

	if (!opts.forceRecompute) {
		const candidate = await findCandidate(merged.pgQuery, opts.window);
		if (candidate) {
			const newer = await countArticlesIngestedAfter(
				merged.pgQuery,
				opts.window,
				candidate.computed_at
			);
			if (newer === 0) {
				await maybeLog(
					merged,
					opts.runId,
					'info',
					`Reusing graph snapshot ${candidate.id} for window ${formatWindow(opts.window)}`
				);
				return { snapshot: toSnapshot(candidate), source: 'cached' };
			}
			await maybeLog(
				merged,
				opts.runId,
				'info',
				`Snapshot ${candidate.id} stale for window ${formatWindow(opts.window)} (${newer} articles ingested since computed_at)`
			);
		}
	}

	return recomputeWithLock(opts, merged);
}

async function recomputeWithLock(
	opts: GetOrComputeSnapshotOptions,
	deps: Required<SnapshotDeps>
): Promise<SnapshotResolution> {
	const lockKey = windowLockKey(opts.window);
	const deadline = deps.now() + LOCK_TOTAL_TIMEOUT_MS;

	while (true) {
		const acquired = await acquireAdvisoryLock(deps.pgQuery, lockKey);
		if (acquired) {
			try {
				return await runRecompute(opts, deps);
			} finally {
				await releaseAdvisoryLock(deps.pgQuery, lockKey);
			}
		}

		if (deps.now() >= deadline) {
			throw new Error(
				`getOrComputeSnapshot: timed out waiting for advisory lock on window ${formatWindow(opts.window)}`
			);
		}

		await deps.sleep(LOCK_RETRY_INTERVAL_MS);

		// Another caller may have finished computing; re-check the candidate.
		const candidate = await findCandidate(deps.pgQuery, opts.window);
		if (candidate) {
			const newer = await countArticlesIngestedAfter(
				deps.pgQuery,
				opts.window,
				candidate.computed_at
			);
			if (newer === 0 && !opts.forceRecompute) {
				await maybeLog(
					deps,
					opts.runId,
					'info',
					`Reusing graph snapshot ${candidate.id} for window ${formatWindow(opts.window)}`
				);
				return { snapshot: toSnapshot(candidate), source: 'cached' };
			}
		}
	}
}

async function runRecompute(
	opts: GetOrComputeSnapshotOptions,
	deps: Required<SnapshotDeps>
): Promise<SnapshotResolution> {
	await maybeLog(
		deps,
		opts.runId,
		'info',
		`Recomputing graph snapshot for window ${formatWindow(opts.window)} (this can take ~5-10s)`
	);

	const start = deps.now();
	const session = deps.getSession();
	let louvainRows: LouvainRow[] = [];
	let pageRankRows: PageRankRow[] = [];
	let gdsVersion = 'unknown';

	try {
		await safeDropProjection(session, 'topic_louvain_window');
		try {
			await session.run(
				`CALL gds.graph.project.cypher(
					'topic_louvain_window',
					'MATCH (t:Topic) WHERE size([(t)<-[:TAGGED_WITH]-(a:Article) WHERE a.publishedAt >= datetime($start) AND a.publishedAt < datetime($end) | a]) >= 3 RETURN id(t) AS id',
					'MATCH (t1:Topic)-[r:RELATED_TO]-(t2:Topic) WHERE size([(t1)<-[:TAGGED_WITH]-(a:Article) WHERE a.publishedAt >= datetime($start) AND a.publishedAt < datetime($end) | a]) >= 3 AND size([(t2)<-[:TAGGED_WITH]-(a:Article) WHERE a.publishedAt >= datetime($start) AND a.publishedAt < datetime($end) | a]) >= 3 RETURN id(t1) AS source, id(t2) AS target, r.weight AS weight',
					{ parameters: { start: $start, end: $end } }
				) YIELD graphName, nodeCount, relationshipCount RETURN graphName, nodeCount, relationshipCount`,
				{ start: opts.window.start.toISOString(), end: opts.window.end.toISOString() }
			);
			const louvainResult = await session.run(
				`CALL gds.louvain.stream('topic_louvain_window', { relationshipWeightProperty: 'weight' })
				 YIELD nodeId, communityId
				 WITH nodeId, communityId, gds.util.asNode(nodeId) AS topic
				 RETURN communityId, topic.name AS name, topic.trendScore AS trendScore
				 ORDER BY communityId, trendScore DESC`
			);
			louvainRows = louvainResult.records.map((r) => ({
				communityId: neoToNum(r.get('communityId')),
				name: r.get('name') as string,
				trendScore: neoToNum(r.get('trendScore'))
			}));
		} finally {
			await safeDropProjection(session, 'topic_louvain_window');
		}

		await safeDropProjection(session, 'entity_pagerank_window');
		try {
			await session.run(
				`CALL gds.graph.project.cypher(
					'entity_pagerank_window',
					'MATCH (e:Entity) WHERE EXISTS { MATCH (a:Article)-[:MENTIONS]->(e) WHERE a.publishedAt >= datetime($start) AND a.publishedAt < datetime($end) } RETURN id(e) AS id',
					'MATCH (e1:Entity)<-[:MENTIONS]-(a:Article)-[:MENTIONS]->(e2:Entity) WHERE id(e1) < id(e2) AND a.publishedAt >= datetime($start) AND a.publishedAt < datetime($end) WITH e1, e2, count(a) AS coMentionCount RETURN id(e1) AS source, id(e2) AS target, coMentionCount AS weight',
					{ parameters: { start: $start, end: $end } }
				) YIELD graphName, nodeCount, relationshipCount RETURN graphName, nodeCount, relationshipCount`,
				{ start: opts.window.start.toISOString(), end: opts.window.end.toISOString() }
			);
			const prResult = await session.run(
				`CALL gds.pageRank.stream('entity_pagerank_window', { relationshipWeightProperty: 'weight' })
				 YIELD nodeId, score
				 WITH nodeId, score, gds.util.asNode(nodeId) AS entity
				 RETURN entity.name AS name, entity.type AS type, score AS pagerank_score, COUNT { (entity)<-[:MENTIONS]-() } AS mention_count
				 ORDER BY score DESC`
			);
			pageRankRows = prResult.records.map((r) => ({
				name: r.get('name') as string,
				type: r.get('type') as string,
				pagerank_score: neoToNum(r.get('pagerank_score')),
				mention_count: neoToNum(r.get('mention_count'))
			}));
		} finally {
			await safeDropProjection(session, 'entity_pagerank_window');
		}

		try {
			const versionResult = await session.run('RETURN gds.version() AS version');
			gdsVersion = (versionResult.records[0]?.get('version') as string) ?? 'unknown';
		} catch {
			gdsVersion = 'unknown';
		}
	} finally {
		await session.close();
	}

	const topicClusters = buildClusters(louvainRows);
	const entityImportance = buildEntityImportance(pageRankRows);

	const metadata = {
		computed_for: 'context-builder',
		window_start: opts.window.start.toISOString(),
		window_end: opts.window.end.toISOString(),
		source_run_id: opts.runId ?? null,
		louvain_filter: 'publishedAt in window AND article_count >= 3',
		total_topics_clustered: louvainRows.length,
		total_entities_ranked: pageRankRows.length,
		gds_version: gdsVersion
	};

	const insertResult = await deps.pgQuery<{ id: string }>(
		`INSERT INTO graph_snapshots (run_id, topic_clusters, entity_importance, metadata)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		[
			opts.runId ?? null,
			JSON.stringify(topicClusters),
			JSON.stringify(entityImportance),
			JSON.stringify(metadata)
		]
	);
	const newId = insertResult.rows[0]?.id;
	if (!newId) {
		throw new Error('getOrComputeSnapshot: insert into graph_snapshots returned no id');
	}

	const elapsed = deps.now() - start;
	await maybeLog(
		deps,
		opts.runId,
		'success',
		`Snapshot recomputed: ${newId} (${(elapsed / 1000).toFixed(1)}s)`
	);

	return {
		snapshot: { id: newId, topicClusters, entityImportance },
		source: 'recomputed',
		computeMs: elapsed
	};
}

async function fetchSnapshotById(pg: PgQueryFn, id: string): Promise<SnapshotRow | null> {
	const result = await pg<SnapshotRow>(
		`SELECT id, topic_clusters, entity_importance, computed_at
		 FROM graph_snapshots WHERE id = $1`,
		[id]
	);
	return result.rows[0] ?? null;
}

async function findCandidate(
	pg: PgQueryFn,
	window: IntelligenceWindow
): Promise<SnapshotRow | null> {
	const result = await pg<SnapshotRow>(
		`SELECT id, topic_clusters, entity_importance, computed_at
		 FROM graph_snapshots
		 WHERE computed_at BETWEEN $1 AND $2
		 ORDER BY computed_at DESC
		 LIMIT 1`,
		[window.start.toISOString(), window.end.toISOString()]
	);
	return result.rows[0] ?? null;
}

async function countArticlesIngestedAfter(
	pg: PgQueryFn,
	window: IntelligenceWindow,
	computedAt: Date | string
): Promise<number> {
	const result = await pg<{ count: string }>(
		`SELECT count(*)::text AS count FROM articles
		 WHERE published_at BETWEEN $1 AND $2
		   AND enriched_at IS NOT NULL AND enriched_at > $3`,
		[
			window.start.toISOString(),
			window.end.toISOString(),
			computedAt instanceof Date ? computedAt.toISOString() : computedAt
		]
	);
	const raw = result.rows[0]?.count ?? '0';
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : 0;
}

async function acquireAdvisoryLock(pg: PgQueryFn, key: number): Promise<boolean> {
	const result = await pg<{ pg_try_advisory_lock: boolean }>(
		'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock',
		[key]
	);
	return Boolean(result.rows[0]?.pg_try_advisory_lock);
}

async function releaseAdvisoryLock(pg: PgQueryFn, key: number): Promise<void> {
	await pg('SELECT pg_advisory_unlock($1)', [key]);
}

async function safeDropProjection(session: Neo4jSessionLike, name: string): Promise<void> {
	const exists = await session.run('CALL gds.graph.exists($name) YIELD exists RETURN exists', {
		name
	});
	if (exists.records[0]?.get('exists')) {
		await session.run('CALL gds.graph.drop($name) YIELD graphName RETURN graphName', { name });
	}
}

function buildClusters(rows: LouvainRow[]): GraphSnapshotCluster[] {
	const groups = new Map<number, { name: string; trend_score: number }[]>();
	for (const row of rows) {
		const list = groups.get(row.communityId) ?? [];
		list.push({ name: row.name, trend_score: row.trendScore });
		groups.set(row.communityId, list);
	}
	const clusters: GraphSnapshotCluster[] = [];
	for (const [cluster_id, topics] of groups) {
		const sorted = topics.sort((a, b) => b.trend_score - a.trend_score).slice(0, 20);
		clusters.push({ cluster_id, topic_count: topics.length, topics: sorted });
	}
	clusters.sort((a, b) => b.topic_count - a.topic_count);
	return clusters;
}

function buildEntityImportance(rows: PageRankRow[]): GraphSnapshotEntity[] {
	return rows.map((row, idx) => ({
		name: row.name,
		type: row.type,
		pagerank_score: row.pagerank_score,
		pagerank_rank: idx + 1,
		mention_count: row.mention_count
	}));
}

function neoToNum(value: unknown): number {
	if (typeof value === 'object' && value !== null && 'toNumber' in value) {
		return (value as { toNumber(): number }).toNumber();
	}
	return Number(value ?? 0);
}

function toSnapshot(row: SnapshotRow): SnapshotResolution['snapshot'] {
	return {
		id: row.id,
		topicClusters: Array.isArray(row.topic_clusters)
			? (row.topic_clusters as GraphSnapshotCluster[])
			: [],
		entityImportance: Array.isArray(row.entity_importance)
			? (row.entity_importance as GraphSnapshotEntity[])
			: []
	};
}

function formatWindow(window: IntelligenceWindow): string {
	return `${window.start.toISOString().slice(0, 10)}..${window.end.toISOString().slice(0, 10)}`;
}

/**
 * Stable 31-bit signed integer derived from the window bounds. Postgres
 * advisory locks accept a bigint; we fit comfortably within the int4 range
 * which keeps node-postgres parameter binding simple.
 */
export function windowLockKey(window: IntelligenceWindow): number {
	const text = `${ADVISORY_LOCK_NAMESPACE}:${window.start.toISOString()}:${window.end.toISOString()}`;
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		hash = (hash * 31 + text.charCodeAt(i)) | 0;
	}
	return hash & 0x7fffffff;
}

async function maybeLog(
	deps: Required<SnapshotDeps>,
	runId: string | undefined,
	level: 'info' | 'warn' | 'success' | 'error',
	message: string
): Promise<void> {
	if (!runId) return;
	try {
		await deps.log(runId, level, 'context', message);
	} catch {
		// Logging is best-effort. Never fail the snapshot resolution because of
		// a transient run_logs insert error.
	}
}
