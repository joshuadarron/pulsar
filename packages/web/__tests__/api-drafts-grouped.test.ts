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

const { GET } = await import('../app/api/drafts/grouped/route.js');

function resetMocks() {
	queryCalls.length = 0;
	mockQuery.mock.resetCalls();
	nextResponses = [];
}

describe('GET /api/drafts/grouped', () => {
	beforeEach(() => {
		resetMocks();
	});

	describe('happy path', () => {
		it('returns grouped reports with topOpportunity and counts', async () => {
			nextResponses = [
				[
					{
						report_id: 'r1',
						generated_at: new Date('2026-04-15T10:00:00Z'),
						top_meaning: 'MCP is moving from spec to load-bearing dependency.',
						draft_count: '6',
						platform_count: '3'
					},
					{
						report_id: 'r2',
						generated_at: new Date('2026-04-08T10:00:00Z'),
						top_meaning: 'Agent stacks are converging on a small set of building blocks.',
						draft_count: '2',
						platform_count: '2'
					}
				]
			];

			const response = await GET();
			const body = await response.json();

			assert.equal(response.status, 200);
			assert.equal(body.groups.length, 2);

			assert.equal(body.groups[0].reportId, 'r1');
			assert.equal(
				body.groups[0].topOpportunity,
				'MCP is moving from spec to load-bearing dependency.'
			);
			assert.equal(body.groups[0].draftCount, 6);
			assert.equal(body.groups[0].platformCount, 3);
			assert.equal(body.groups[0].generatedAt, '2026-04-15T10:00:00.000Z');

			assert.equal(body.groups[1].reportId, 'r2');
			assert.equal(body.groups[1].draftCount, 2);
		});

		it('issues a single SQL query that joins reports and content_drafts', async () => {
			nextResponses = [[]];
			await GET();
			assert.equal(queryCalls.length, 1);
			assert.match(queryCalls[0].sql, /FROM reports/);
			assert.match(queryCalls[0].sql, /JOIN content_drafts/);
			assert.match(queryCalls[0].sql, /ORDER BY r\.generated_at DESC/);
		});

		it('coerces COUNT() string values to numbers', async () => {
			nextResponses = [
				[
					{
						report_id: 'r1',
						generated_at: new Date('2026-04-15T10:00:00Z'),
						top_meaning: null,
						draft_count: '11',
						platform_count: '4'
					}
				]
			];
			const response = await GET();
			const body = await response.json();
			assert.strictEqual(body.groups[0].draftCount, 11);
			assert.strictEqual(body.groups[0].platformCount, 4);
		});
	});

	describe('empty cases', () => {
		it('returns an empty groups array when no reports have drafts', async () => {
			nextResponses = [[]];
			const response = await GET();
			const body = await response.json();
			assert.deepEqual(body.groups, []);
		});

		it('returns null topOpportunity when the report has no interpretations', async () => {
			nextResponses = [
				[
					{
						report_id: 'r1',
						generated_at: new Date('2026-04-15T10:00:00Z'),
						top_meaning: null,
						draft_count: '1',
						platform_count: '1'
					}
				]
			];
			const response = await GET();
			const body = await response.json();
			assert.equal(body.groups[0].topOpportunity, null);
		});
	});

	describe('serialization', () => {
		it('serializes generatedAt as an ISO-8601 string even when DB returns a Date', async () => {
			nextResponses = [
				[
					{
						report_id: 'r1',
						generated_at: new Date('2026-04-15T10:00:00Z'),
						top_meaning: 'meaning',
						draft_count: '1',
						platform_count: '1'
					}
				]
			];
			const response = await GET();
			const body = await response.json();
			assert.equal(typeof body.groups[0].generatedAt, 'string');
			assert.equal(body.groups[0].generatedAt, '2026-04-15T10:00:00.000Z');
		});
	});
});
