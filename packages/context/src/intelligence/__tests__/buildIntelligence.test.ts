import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

interface PgScript {
	matcher: (sql: string) => boolean;
	rows: Array<Record<string, unknown>>;
}

let pgScripts: PgScript[] = [];
const pgCalls: Array<{ sql: string; params: unknown[] }> = [];

const mockQuery = mock.fn(async (sql: string, params?: unknown[]) => {
	pgCalls.push({ sql, params: params ?? [] });
	const matched = pgScripts.find((s) => s.matcher(sql));
	const rows = matched?.rows ?? [];
	return { rows, rowCount: rows.length };
});

// Do NOT include a `default` key inside namedExports here. Node 22's
// mock.module generates `export let default = ...` for it (a syntax error,
// since `default` is a reserved word in `let` bindings). The default pool
// export is not used by the SUT under test, so we simply omit it.
mock.module('@pulsar/shared/db/postgres', {
	namedExports: {
		query: mockQuery,
		getClient: async () => ({ release: () => {} })
	}
});

interface NeoScript {
	matcher: (cypher: string) => boolean;
	records: Array<Record<string, unknown>>;
}

let neoScripts: NeoScript[] = [];
const neoCalls: string[] = [];
let sessionCloses = 0;

const mockGetSession = mock.fn(() => ({
	run: async (cypher: string) => {
		neoCalls.push(cypher);
		const matched = neoScripts.find((s) => s.matcher(cypher));
		const records = (matched?.records ?? []).map((r) => ({
			get: (k: string) => r[k]
		}));
		return { records };
	},
	close: async () => {
		sessionCloses++;
	}
}));

mock.module('@pulsar/shared/db/neo4j', {
	namedExports: {
		getSession: mockGetSession,
		getDriver: () => ({}),
		closeDriver: async () => {}
	}
});

mock.module('@pulsar/shared/run-logger', {
	namedExports: {
		logRun: async () => {}
	}
});

const { buildIntelligence } = await import('../index.js');

const window = {
	start: new Date('2026-04-01T00:00:00Z'),
	end: new Date('2026-05-01T00:00:00Z')
};

function resetMocks() {
	pgCalls.length = 0;
	neoCalls.length = 0;
	sessionCloses = 0;
	mockQuery.mock.resetCalls();
	mockGetSession.mock.resetCalls();
	pgScripts = [];
	neoScripts = [];
}

describe('buildIntelligence', () => {
	beforeEach(() => {
		resetMocks();
	});

	it('composes a fully-formed IntelligenceContext from cached snapshot + per-loader queries', async () => {
		pgScripts = [
			{
				matcher: (sql) => sql.includes('FROM graph_snapshots WHERE id = $1'),
				rows: [
					{
						id: 'preferred-snap',
						topic_clusters: [
							{
								cluster_id: 1,
								topic_count: 4,
								topics: [
									{ name: 'agents', trend_score: 5 },
									{ name: 'rag', trend_score: 3 }
								]
							}
						],
						entity_importance: [
							{
								name: 'OpenAI',
								type: 'org',
								pagerank_score: 0.5,
								pagerank_rank: 1,
								mention_count: 12
							}
						],
						computed_at: new Date('2026-04-15T00:00:00Z')
					}
				]
			},
			{
				matcher: (sql) =>
					sql.includes('unnest(topic_tags)') && sql.includes('LIMIT $3') && !sql.includes('30'),
				rows: [{ keyword: 'agents', count: '20' }]
			},
			{
				matcher: (sql) => sql.includes('unnest(topic_tags)') && sql.includes('LIMIT $3'),
				rows: [{ keyword: 'agents', count: '40' }]
			},
			{
				matcher: (sql) =>
					sql.includes('FROM articles') && sql.includes('comment_count IS NOT NULL'),
				rows: [
					{
						title: 'Discussion 1',
						url: 'https://x/1',
						comment_count: '50',
						source_name: 'hn'
					}
				]
			},
			{
				matcher: (sql) => sql.includes("COALESCE(sentiment, 'neutral')"),
				rows: [
					{ sentiment: 'positive', count: '10' },
					{ sentiment: 'neutral', count: '20' }
				]
			},
			{
				matcher: (sql) => sql.includes('count(DISTINCT source_name)'),
				rows: [{ article_count: '100', source_count: '5' }]
			}
		];

		neoScripts = [
			{
				matcher: (c) => c.includes('AUTHORED_BY'),
				records: [{ handle: 'simonw', platform: 'rss', articleCount: 7 }]
			},
			{
				matcher: (c) => c.includes('firstSeen'),
				records: [{ name: 'mcp' }, { name: 'agents' }]
			},
			{
				matcher: (c) => c.includes('t.name IN $names'),
				records: [
					{ name: 'agents', trendScore: 9 },
					{ name: 'rag', trendScore: 3 }
				]
			}
		];

		const context = await buildIntelligence({
			window,
			preferredSnapshotId: 'preferred-snap',
			includeEntityHistory: false
		});

		assert.equal(context.graphSnapshotId, 'preferred-snap');
		assert.equal(context.graphSnapshotSource, 'cached');
		assert.equal(context.articleCount, 100);
		assert.equal(context.sourceCount, 5);
		assert.equal(context.entities.length, 1);
		assert.equal(context.entities[0].name, 'OpenAI');
		assert.equal(context.topicClusters.length, 1);
		assert.deepEqual(context.topicClusters[0].topTopics.slice(0, 1), ['agents']);
		assert.equal(context.topDiscussions.length, 1);
		assert.equal(context.topDiscussions[0].commentCount, 50);
		assert.deepEqual(context.sentimentBreakdown, {
			positive: 10,
			neutral: 20,
			negative: 0
		});
		assert.equal(context.topAuthors.length, 1);
		assert.equal(context.topAuthors[0].handle, 'simonw');
		assert.deepEqual(context.emergingTopics, ['mcp', 'agents']);
		assert.equal(context.trendingKeywords.length, 1);
		assert.equal(context.period.start.getTime(), window.start.getTime());
	});

	it('marks graphSnapshotSource as recomputed when no candidate exists', async () => {
		pgScripts = [
			{
				matcher: (sql) => sql.includes('WHERE computed_at BETWEEN'),
				rows: []
			},
			{
				matcher: (sql) => sql.includes('pg_try_advisory_lock'),
				rows: [{ pg_try_advisory_lock: true }]
			},
			{
				matcher: (sql) => sql.includes('INSERT INTO graph_snapshots'),
				rows: [{ id: 'fresh-snap' }]
			},
			{
				matcher: (sql) => sql.includes('pg_advisory_unlock'),
				rows: [{}]
			},
			{
				matcher: (sql) => sql.includes('unnest(topic_tags)'),
				rows: []
			},
			{
				matcher: (sql) =>
					sql.includes('FROM articles') && sql.includes('comment_count IS NOT NULL'),
				rows: []
			},
			{
				matcher: (sql) => sql.includes("COALESCE(sentiment, 'neutral')"),
				rows: []
			},
			{
				matcher: (sql) => sql.includes('count(DISTINCT source_name)'),
				rows: [{ article_count: '0', source_count: '0' }]
			}
		];

		neoScripts = [
			{ matcher: (c) => c.includes('gds.graph.exists'), records: [{ exists: false }] },
			{ matcher: (c) => c.includes('gds.graph.project.cypher'), records: [] },
			{ matcher: (c) => c.includes('gds.louvain.stream'), records: [] },
			{ matcher: (c) => c.includes('gds.pageRank.stream'), records: [] },
			{ matcher: (c) => c.includes('gds.version'), records: [{ version: '2.13.0' }] },
			{ matcher: (c) => c.includes('AUTHORED_BY'), records: [] },
			{ matcher: (c) => c.includes('firstSeen'), records: [] }
		];

		const context = await buildIntelligence({
			window,
			includeEntityHistory: false
		});

		assert.equal(context.graphSnapshotId, 'fresh-snap');
		assert.equal(context.graphSnapshotSource, 'recomputed');
		assert.equal(context.articleCount, 0);
		assert.equal(context.sourceCount, 0);
		assert.deepEqual(context.entities, []);
		assert.deepEqual(context.trendingKeywords, []);
		assert.deepEqual(context.topDiscussions, []);
		assert.deepEqual(context.topAuthors, []);
		assert.deepEqual(context.emergingTopics, []);
	});
});
