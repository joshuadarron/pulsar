import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	type PgQueryFn,
	loadEmergingTopics,
	loadSentimentBreakdown,
	loadTopAuthors,
	loadTopDiscussions
} from '../discussions.js';
import type { Neo4jSessionLike } from '../snapshot.js';

const window = {
	start: new Date('2026-04-01T00:00:00Z'),
	end: new Date('2026-05-01T00:00:00Z')
};

describe('loadTopDiscussions', () => {
	it('maps articles rows to discussion records', async () => {
		const pg: PgQueryFn = async <T>() => ({
			rows: [
				{
					title: 'Hello agents',
					url: 'https://x.test/agents',
					comment_count: '42',
					source_name: 'hackernews'
				},
				{
					title: 'RAG patterns',
					url: 'https://x.test/rag',
					comment_count: '21',
					source_name: 'reddit'
				}
			] as unknown as T[],
			rowCount: 2
		});

		const result = await loadTopDiscussions(window, { pgQuery: pg });
		assert.equal(result.length, 2);
		assert.deepEqual(result[0], {
			title: 'Hello agents',
			url: 'https://x.test/agents',
			source: 'hackernews',
			commentCount: 42
		});
	});
});

describe('loadSentimentBreakdown', () => {
	it('returns zeros for an empty period', async () => {
		const pg: PgQueryFn = async <T>() => ({ rows: [] as unknown as T[], rowCount: 0 });
		const result = await loadSentimentBreakdown(window, { pgQuery: pg });
		assert.deepEqual(result, { positive: 0, neutral: 0, negative: 0 });
	});

	it('aggregates the three sentiment buckets', async () => {
		const pg: PgQueryFn = async <T>() => ({
			rows: [
				{ sentiment: 'positive', count: '12' },
				{ sentiment: 'neutral', count: '30' },
				{ sentiment: 'negative', count: '4' }
			] as unknown as T[],
			rowCount: 3
		});
		const result = await loadSentimentBreakdown(window, { pgQuery: pg });
		assert.deepEqual(result, { positive: 12, neutral: 30, negative: 4 });
	});

	it('ignores unknown sentiment labels', async () => {
		const pg: PgQueryFn = async <T>() => ({
			rows: [
				{ sentiment: 'positive', count: '5' },
				{ sentiment: 'mixed', count: '10' }
			] as unknown as T[],
			rowCount: 2
		});
		const result = await loadSentimentBreakdown(window, { pgQuery: pg });
		assert.deepEqual(result, { positive: 5, neutral: 0, negative: 0 });
	});
});

function makeNeo4j(rows: Array<Record<string, unknown>>): Neo4jSessionLike {
	return {
		run: async () => ({
			records: rows.map((r) => ({
				get: (k: string) => r[k]
			}))
		}),
		close: async () => {}
	};
}

describe('loadTopAuthors', () => {
	it('maps Neo4j rows to author records', async () => {
		const session = makeNeo4j([
			{ handle: 'simonw', platform: 'rss', articleCount: 7 },
			{ handle: 'dhh', platform: 'rss', articleCount: 4 }
		]);

		const result = await loadTopAuthors(window, { getSession: () => session });
		assert.equal(result.length, 2);
		assert.deepEqual(result[0], { handle: 'simonw', platform: 'rss', articleCount: 7 });
	});

	it('falls back to "unknown" when platform is missing', async () => {
		const session = makeNeo4j([{ handle: 'anon', platform: '', articleCount: 1 }]);
		const result = await loadTopAuthors(window, { getSession: () => session });
		assert.equal(result[0].platform, 'unknown');
	});
});

describe('loadEmergingTopics', () => {
	it('returns topic names ordered by trendScore desc', async () => {
		const session = makeNeo4j([{ name: 'agents' }, { name: 'rag' }]);
		const result = await loadEmergingTopics(window, { getSession: () => session });
		assert.deepEqual(result, ['agents', 'rag']);
	});

	it('returns an empty array when top is zero', async () => {
		const session = makeNeo4j([]);
		const result = await loadEmergingTopics(window, { getSession: () => session, top: 0 });
		assert.deepEqual(result, []);
	});
});
