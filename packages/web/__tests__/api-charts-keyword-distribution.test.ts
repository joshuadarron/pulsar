import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

interface QueryCall {
	sql: string;
	params: unknown[];
}

const queryCalls: QueryCall[] = [];

interface QueryResponseRow {
	[key: string]: string;
}

let nextResponses: QueryResponseRow[][] = [];

const mockQuery = mock.fn(async (sql: string, params?: unknown[]) => {
	queryCalls.push({ sql, params: params ?? [] });
	const rows = nextResponses.shift() ?? [];
	return { rows };
});

mock.module('@pulsar/shared/db/postgres', {
	namedExports: { query: mockQuery }
});

const { GET } = await import('../app/api/charts/keyword-distribution/route.js');
const { NextRequest } = await import('next/server');

function buildRequest(qs = ''): InstanceType<typeof NextRequest> {
	const url = `http://localhost/api/charts/keyword-distribution${qs ? `?${qs}` : ''}`;
	return new NextRequest(url);
}

function resetMocks() {
	queryCalls.length = 0;
	mockQuery.mock.resetCalls();
	nextResponses = [];
}

describe('GET /api/charts/keyword-distribution', () => {
	beforeEach(() => {
		resetMocks();
	});

	describe('happy path', () => {
		it('returns top N keywords plus an Other bucket and percentages', async () => {
			nextResponses = [
				[{ total_articles: '100' }],
				[{ total: '200' }],
				[
					{ keyword: 'rag', count: '60' },
					{ keyword: 'agents', count: '50' },
					{ keyword: 'mcp', count: '30' }
				]
			];

			const response = await GET(buildRequest('top=3&windowDays=7'));
			const body = await response.json();

			assert.equal(body.meta.totalArticles, 100);
			assert.equal(body.distribution.length, 4);
			assert.equal(body.distribution[0].keyword, 'rag');
			assert.equal(body.distribution[0].count, 60);
			assert.equal(Math.round(body.distribution[0].pct), 30);
			assert.equal(body.distribution.at(-1)?.keyword, 'Other');
			assert.equal(body.distribution.at(-1)?.count, 60);
		});

		it('omits the Other bucket when top covers all keywords', async () => {
			nextResponses = [
				[{ total_articles: '10' }],
				[{ total: '5' }],
				[
					{ keyword: 'rag', count: '3' },
					{ keyword: 'agents', count: '2' }
				]
			];

			const response = await GET(buildRequest('top=10'));
			const body = await response.json();

			assert.equal(body.distribution.length, 2);
			assert.ok(!body.distribution.some((d: { keyword: string }) => d.keyword === 'Other'));
		});
	});

	describe('sparse data', () => {
		it('returns an empty distribution and totalArticles=0 when no articles match the window', async () => {
			nextResponses = [[{ total_articles: '0' }]];

			const response = await GET(buildRequest());
			const body = await response.json();

			assert.equal(body.meta.totalArticles, 0);
			assert.deepEqual(body.distribution, []);
			assert.ok(body.meta.windowStart);
			assert.ok(body.meta.windowEnd);
			assert.equal(queryCalls.length, 1);
		});

		it('returns an empty distribution when articles exist but no topic_tags do', async () => {
			nextResponses = [[{ total_articles: '5' }], [{ total: '0' }]];

			const response = await GET(buildRequest());
			const body = await response.json();

			assert.equal(body.meta.totalArticles, 5);
			assert.deepEqual(body.distribution, []);
		});
	});

	describe('query param parsing', () => {
		it('uses defaults when params are missing', async () => {
			nextResponses = [[{ total_articles: '0' }]];

			const response = await GET(buildRequest());
			const body = await response.json();
			const start = new Date(body.meta.windowStart);
			const end = new Date(body.meta.windowEnd);
			const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

			assert.equal(days, 30);
			assert.equal(response.status, 200);
		});

		it('falls back to default top when param is invalid', async () => {
			nextResponses = [
				[{ total_articles: '1' }],
				[{ total: '1' }],
				[{ keyword: 'rag', count: '1' }]
			];

			const response = await GET(buildRequest('top=not-a-number'));
			assert.equal(response.status, 200);
			const lastCall = queryCalls.at(-1);
			assert.equal(lastCall?.params[2], 10);
		});

		it('caps top at the documented maximum', async () => {
			nextResponses = [
				[{ total_articles: '1' }],
				[{ total: '1' }],
				[{ keyword: 'rag', count: '1' }]
			];

			await GET(buildRequest('top=99999'));
			const lastCall = queryCalls.at(-1);
			assert.equal(lastCall?.params[2], 100);
		});

		it('caps windowDays at the documented maximum', async () => {
			nextResponses = [[{ total_articles: '0' }]];

			const response = await GET(buildRequest('windowDays=99999'));
			const body = await response.json();
			const start = new Date(body.meta.windowStart);
			const end = new Date(body.meta.windowEnd);
			const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

			assert.equal(days, 365);
		});
	});
});
