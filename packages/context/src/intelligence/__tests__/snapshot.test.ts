import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	type Neo4jSessionLike,
	type PgQueryFn,
	type SnapshotDeps,
	getOrComputeSnapshot,
	windowLockKey
} from '../snapshot.js';

type PgRow = Record<string, unknown>;

interface ScriptedQuery {
	matcher: (sql: string, params: unknown[]) => boolean;
	respond: (sql: string, params: unknown[]) => PgRow[] | Error;
}

function makePg(scripts: ScriptedQuery[]): {
	pg: PgQueryFn;
	calls: Array<{ sql: string; params: unknown[] }>;
} {
	const calls: Array<{ sql: string; params: unknown[] }> = [];
	const pg: PgQueryFn = async <T>(sql: string, params?: unknown[]) => {
		const ps = params ?? [];
		calls.push({ sql, params: ps });
		const matched = scripts.find((s) => s.matcher(sql, ps));
		if (!matched) {
			throw new Error(`Unscripted query: ${sql.slice(0, 100)}`);
		}
		const result = matched.respond(sql, ps);
		if (result instanceof Error) throw result;
		return { rows: result as unknown as T[], rowCount: result.length };
	};
	return { pg, calls };
}

function makeNeo4jSession(): {
	session: Neo4jSessionLike;
	closes: number;
	runs: Array<{ cypher: string; params?: Record<string, unknown> }>;
} {
	let closes = 0;
	const runs: Array<{ cypher: string; params?: Record<string, unknown> }> = [];
	const session: Neo4jSessionLike = {
		run: async (cypher, params) => {
			runs.push({ cypher, params });
			if (cypher.includes('gds.graph.exists')) {
				return { records: [{ get: () => false }] };
			}
			if (cypher.includes('gds.version()')) {
				return { records: [{ get: (_k: string) => '2.13.0' }] };
			}
			if (cypher.includes('gds.louvain.stream')) {
				return {
					records: [
						{
							get: (k: string) =>
								k === 'communityId' ? 1 : k === 'name' ? 'topic-a' : k === 'trendScore' ? 5 : null
						}
					]
				};
			}
			if (cypher.includes('gds.pageRank.stream')) {
				return {
					records: [
						{
							get: (k: string) =>
								k === 'name'
									? 'entity-a'
									: k === 'type'
										? 'concept'
										: k === 'pagerank_score'
											? 0.42
											: k === 'mention_count'
												? 10
												: null
						}
					]
				};
			}
			return { records: [] };
		},
		close: async () => {
			closes++;
		}
	};
	return { session, closes, runs };
}

function fakeDeps(pg: PgQueryFn, session?: Neo4jSessionLike): SnapshotDeps {
	return {
		pgQuery: pg,
		getSession: () => session ?? makeNeo4jSession().session,
		log: async () => {},
		sleep: async () => {},
		now: () => 1_700_000_000_000
	};
}

const window = {
	start: new Date('2026-04-01T00:00:00Z'),
	end: new Date('2026-05-01T00:00:00Z')
};

describe('windowLockKey', () => {
	it('produces a stable 31-bit non-negative integer', () => {
		const a = windowLockKey(window);
		const b = windowLockKey(window);
		assert.equal(a, b);
		assert.ok(Number.isInteger(a));
		assert.ok(a >= 0 && a <= 0x7fffffff);
	});

	it('changes when the window changes', () => {
		const a = windowLockKey(window);
		const b = windowLockKey({ ...window, end: new Date('2026-05-02T00:00:00Z') });
		assert.notEqual(a, b);
	});
});

describe('getOrComputeSnapshot', () => {
	describe('preferredId hit', () => {
		it('fetches the snapshot by id and returns cached', async () => {
			const { pg, calls } = makePg([
				{
					matcher: (sql) => sql.includes('FROM graph_snapshots WHERE id = $1'),
					respond: () => [
						{
							id: 'preferred-id',
							topic_clusters: [{ cluster_id: 1, topic_count: 2, topics: [] }],
							entity_importance: [
								{ name: 'a', type: 't', pagerank_score: 0.5, pagerank_rank: 1, mention_count: 3 }
							],
							computed_at: new Date('2026-04-15T00:00:00Z')
						}
					]
				}
			]);

			const result = await getOrComputeSnapshot(
				{ window, preferredId: 'preferred-id' },
				fakeDeps(pg)
			);

			assert.equal(result.source, 'cached');
			assert.equal(result.snapshot.id, 'preferred-id');
			assert.equal(result.snapshot.topicClusters.length, 1);
			assert.equal(result.snapshot.entityImportance.length, 1);
			assert.equal(calls.length, 1);
		});

		it('throws when the preferredId row does not exist', async () => {
			const { pg } = makePg([
				{
					matcher: (sql) => sql.includes('FROM graph_snapshots WHERE id = $1'),
					respond: () => []
				}
			]);

			await assert.rejects(
				getOrComputeSnapshot({ window, preferredId: 'missing' }, fakeDeps(pg)),
				/Snapshot not found: missing/
			);
		});
	});

	describe('window cache hit', () => {
		it('returns the latest in-window snapshot when no new articles have been ingested', async () => {
			const { pg } = makePg([
				{
					matcher: (sql) => sql.includes('WHERE computed_at BETWEEN'),
					respond: () => [
						{
							id: 'cached-id',
							topic_clusters: [],
							entity_importance: [],
							computed_at: new Date('2026-04-15T00:00:00Z')
						}
					]
				},
				{
					matcher: (sql) => sql.includes('FROM articles'),
					respond: () => [{ count: '0' }]
				}
			]);

			const result = await getOrComputeSnapshot({ window }, fakeDeps(pg));

			assert.equal(result.source, 'cached');
			assert.equal(result.snapshot.id, 'cached-id');
		});
	});

	describe('stale snapshot triggers recompute', () => {
		it('runs Louvain + PageRank and inserts a new row when articles have been ingested since computed_at', async () => {
			const { session } = makeNeo4jSession();
			const { pg, calls } = makePg([
				{
					matcher: (sql) => sql.includes('WHERE computed_at BETWEEN'),
					respond: () => [
						{
							id: 'stale-id',
							topic_clusters: [],
							entity_importance: [],
							computed_at: new Date('2026-04-15T00:00:00Z')
						}
					]
				},
				{
					matcher: (sql) => sql.includes('FROM articles'),
					respond: () => [{ count: '12' }]
				},
				{
					matcher: (sql) => sql.includes('pg_try_advisory_lock'),
					respond: () => [{ pg_try_advisory_lock: true }]
				},
				{
					matcher: (sql) => sql.includes('INSERT INTO graph_snapshots'),
					respond: () => [{ id: 'new-id' }]
				},
				{
					matcher: (sql) => sql.includes('pg_advisory_unlock'),
					respond: () => [{}]
				}
			]);

			const result = await getOrComputeSnapshot({ window, runId: 'r1' }, fakeDeps(pg, session));

			assert.equal(result.source, 'recomputed');
			assert.equal(result.snapshot.id, 'new-id');
			assert.equal(result.snapshot.topicClusters.length, 1);
			assert.equal(result.snapshot.entityImportance.length, 1);
			assert.ok(typeof result.computeMs === 'number');
			// Insert metadata should include source_run_id
			const insertCall = calls.find((c) => c.sql.includes('INSERT INTO graph_snapshots'));
			assert.ok(insertCall);
			assert.equal(insertCall?.params[0], 'r1');
		});
	});

	describe('missing snapshot triggers recompute', () => {
		it('recomputes when no candidate exists in the window', async () => {
			const { session } = makeNeo4jSession();
			const { pg } = makePg([
				{
					matcher: (sql) => sql.includes('WHERE computed_at BETWEEN'),
					respond: () => []
				},
				{
					matcher: (sql) => sql.includes('pg_try_advisory_lock'),
					respond: () => [{ pg_try_advisory_lock: true }]
				},
				{
					matcher: (sql) => sql.includes('INSERT INTO graph_snapshots'),
					respond: () => [{ id: 'fresh-id' }]
				},
				{
					matcher: (sql) => sql.includes('pg_advisory_unlock'),
					respond: () => [{}]
				}
			]);

			const result = await getOrComputeSnapshot({ window }, fakeDeps(pg, session));

			assert.equal(result.source, 'recomputed');
			assert.equal(result.snapshot.id, 'fresh-id');
		});
	});

	describe('forceRecompute', () => {
		it('skips cache check and recomputes even when a fresh candidate exists', async () => {
			const { session } = makeNeo4jSession();
			const { pg, calls } = makePg([
				{
					matcher: (sql) => sql.includes('pg_try_advisory_lock'),
					respond: () => [{ pg_try_advisory_lock: true }]
				},
				{
					matcher: (sql) => sql.includes('INSERT INTO graph_snapshots'),
					respond: () => [{ id: 'forced-id' }]
				},
				{
					matcher: (sql) => sql.includes('pg_advisory_unlock'),
					respond: () => [{}]
				}
			]);

			const result = await getOrComputeSnapshot(
				{ window, forceRecompute: true },
				fakeDeps(pg, session)
			);

			assert.equal(result.source, 'recomputed');
			assert.equal(result.snapshot.id, 'forced-id');
			// Should never have queried the candidate or article-count tables.
			assert.ok(!calls.some((c) => c.sql.includes('WHERE computed_at BETWEEN')));
		});
	});

	describe('advisory lock contention', () => {
		it('retries the lock once and proceeds when another caller had it', async () => {
			const { session } = makeNeo4jSession();
			let lockAttempts = 0;
			const { pg } = makePg([
				{
					matcher: (sql) => sql.includes('WHERE computed_at BETWEEN'),
					respond: () => []
				},
				{
					matcher: (sql) => sql.includes('pg_try_advisory_lock'),
					respond: () => {
						lockAttempts++;
						return [{ pg_try_advisory_lock: lockAttempts >= 2 }];
					}
				},
				{
					matcher: (sql) => sql.includes('INSERT INTO graph_snapshots'),
					respond: () => [{ id: 'eventually-id' }]
				},
				{
					matcher: (sql) => sql.includes('pg_advisory_unlock'),
					respond: () => [{}]
				}
			]);

			let nowValue = 1_700_000_000_000;
			const deps: SnapshotDeps = {
				pgQuery: pg,
				getSession: () => session,
				log: async () => {},
				sleep: async () => {
					nowValue += 250;
				},
				now: () => nowValue
			};

			const result = await getOrComputeSnapshot({ window }, deps);

			assert.equal(result.source, 'recomputed');
			assert.equal(result.snapshot.id, 'eventually-id');
			assert.equal(lockAttempts, 2);
		});

		it('returns a cached candidate if one appears while waiting for the lock', async () => {
			const { session } = makeNeo4jSession();
			let candidateCalls = 0;
			let lockAttempts = 0;
			const { pg } = makePg([
				{
					matcher: (sql) => sql.includes('WHERE computed_at BETWEEN'),
					respond: () => {
						candidateCalls++;
						if (candidateCalls === 1) return [];
						return [
							{
								id: 'peer-computed-id',
								topic_clusters: [],
								entity_importance: [],
								computed_at: new Date('2026-04-20T00:00:00Z')
							}
						];
					}
				},
				{
					matcher: (sql) => sql.includes('pg_try_advisory_lock'),
					respond: () => {
						lockAttempts++;
						return [{ pg_try_advisory_lock: false }];
					}
				},
				{
					matcher: (sql) => sql.includes('FROM articles'),
					respond: () => [{ count: '0' }]
				}
			]);

			let nowValue = 1_700_000_000_000;
			const deps: SnapshotDeps = {
				pgQuery: pg,
				getSession: () => session,
				log: async () => {},
				sleep: async () => {
					nowValue += 250;
				},
				now: () => nowValue
			};

			const result = await getOrComputeSnapshot({ window }, deps);

			assert.equal(result.source, 'cached');
			assert.equal(result.snapshot.id, 'peer-computed-id');
			assert.equal(lockAttempts, 1);
		});
	});
});
