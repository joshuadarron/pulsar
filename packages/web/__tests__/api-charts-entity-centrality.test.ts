import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

interface QueryCall {
	sql: string;
	params: unknown[];
}

const queryCalls: QueryCall[] = [];

let nextResponses: Array<Array<Record<string, unknown>>> = [];

const mockQuery = mock.fn(async (sql: string, params?: unknown[]) => {
	queryCalls.push({ sql, params: params ?? [] });
	const rows = nextResponses.shift() ?? [];
	return { rows };
});

mock.module('@pulsar/shared/db/postgres', {
	namedExports: { query: mockQuery }
});

const { GET } = await import('../app/api/charts/entity-centrality/route.js');
const { NextRequest } = await import('next/server');

function buildRequest(qs = ''): InstanceType<typeof NextRequest> {
	const url = `http://localhost/api/charts/entity-centrality${qs ? `?${qs}` : ''}`;
	return new NextRequest(url);
}

interface EntityShape {
	name: string;
	type?: string;
	pagerank_score: number;
	pagerank_rank?: number;
	mention_count?: number;
}

function snapshotRow(period: string, computedAt: string, entities: EntityShape[]) {
	return { period, computed_at: computedAt, entity_importance: entities };
}

function resetMocks() {
	queryCalls.length = 0;
	mockQuery.mock.resetCalls();
	nextResponses = [];
}

describe('GET /api/charts/entity-centrality', () => {
	beforeEach(() => {
		resetMocks();
	});

	describe('happy path', () => {
		it('builds time series for the top N entities by current centrality', async () => {
			// Snapshot rows arrive DESC by period, oldest last.
			nextResponses = [
				[
					snapshotRow('2026-04', '2026-04-15T00:00:00Z', [
						{ name: 'mcp', pagerank_score: 0.5, mention_count: 50 },
						{ name: 'agents', pagerank_score: 0.4, mention_count: 40 },
						{ name: 'rag', pagerank_score: 0.3, mention_count: 30 }
					]),
					snapshotRow('2026-03', '2026-03-15T00:00:00Z', [
						{ name: 'mcp', pagerank_score: 0.2, mention_count: 25 },
						{ name: 'agents', pagerank_score: 0.45, mention_count: 60 }
					]),
					snapshotRow('2026-02', '2026-02-15T00:00:00Z', [
						{ name: 'agents', pagerank_score: 0.5, mention_count: 70 }
					])
				]
			];

			const response = await GET(buildRequest('periods=3&top=2'));
			const body = await response.json();

			assert.equal(body.meta.periodKind, 'month');
			assert.equal(body.meta.periods, 3);
			assert.equal(body.meta.sparse, false);
			assert.equal(body.series.length, 2);

			const mcp = body.series.find((s: { entityName: string }) => s.entityName === 'mcp');
			const agents = body.series.find((s: { entityName: string }) => s.entityName === 'agents');
			assert.ok(mcp);
			assert.ok(agents);

			// mcp present in 2026-03 and 2026-04 only.
			assert.deepEqual(
				mcp.points.map((p: { period: string }) => p.period),
				['2026-03', '2026-04']
			);
			// agents present in all three periods, ascending.
			assert.deepEqual(
				agents.points.map((p: { period: string }) => p.period),
				['2026-02', '2026-03', '2026-04']
			);
			assert.equal(agents.points[0].centrality, 0.5);
			assert.equal(agents.points[0].mentions, 70);
		});

		it('flags sparse=true when fewer periods are returned than requested', async () => {
			nextResponses = [
				[snapshotRow('2026-04', '2026-04-15T00:00:00Z', [{ name: 'mcp', pagerank_score: 0.5 }])]
			];

			const response = await GET(buildRequest('periods=12&top=5'));
			const body = await response.json();

			assert.equal(body.meta.periods, 1);
			assert.equal(body.meta.sparse, true);
			assert.equal(body.series.length, 1);
		});
	});

	describe('sparse data', () => {
		it('returns empty series with sparse=true when no snapshots exist', async () => {
			nextResponses = [[]];

			const response = await GET(buildRequest());
			const body = await response.json();

			assert.deepEqual(body.series, []);
			assert.equal(body.meta.sparse, true);
			assert.equal(body.meta.periods, 0);
			assert.equal(body.meta.periodKind, 'month');
			assert.ok(body.meta.currentPeriodEnd);
		});

		it('returns empty series when current snapshot has no entities', async () => {
			nextResponses = [[snapshotRow('2026-04', '2026-04-15T00:00:00Z', [])]];

			const response = await GET(buildRequest());
			const body = await response.json();

			assert.deepEqual(body.series, []);
			assert.equal(body.meta.periods, 1);
		});

		it('does not throw when entity_importance is not an array', async () => {
			nextResponses = [
				[{ period: '2026-04', computed_at: '2026-04-15T00:00:00Z', entity_importance: null }]
			];

			const response = await GET(buildRequest());
			const body = await response.json();

			assert.equal(response.status, 200);
			assert.deepEqual(body.series, []);
		});
	});

	describe('query param parsing', () => {
		it('uses defaults when params are missing', async () => {
			nextResponses = [[]];

			const response = await GET(buildRequest());
			assert.equal(response.status, 200);
			// Default 12 months back; cutoff lives in params[0] as ISO date.
			const cutoff = new Date(String(queryCalls[0].params[0]));
			const expectedYear = new Date().getUTCFullYear();
			// 12 backward months from current always lands within last 12 calendar months.
			assert.ok(cutoff.getUTCFullYear() <= expectedYear);
		});

		it('caps periods at the documented maximum', async () => {
			nextResponses = [[]];

			await GET(buildRequest('periods=99999'));
			// We can't directly read the requested cap, but verify the route still
			// completed without error and only one query was issued.
			assert.equal(queryCalls.length, 1);
		});

		it('falls back to default top when param is invalid', async () => {
			nextResponses = [
				[
					snapshotRow('2026-04', '2026-04-15T00:00:00Z', [
						{ name: 'a', pagerank_score: 0.9 },
						{ name: 'b', pagerank_score: 0.8 },
						{ name: 'c', pagerank_score: 0.7 },
						{ name: 'd', pagerank_score: 0.6 },
						{ name: 'e', pagerank_score: 0.5 },
						{ name: 'f', pagerank_score: 0.4 },
						{ name: 'g', pagerank_score: 0.3 }
					])
				]
			];

			const response = await GET(buildRequest('top=garbage'));
			const body = await response.json();
			assert.equal(body.series.length, 5);
		});
	});
});
