import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	buildPeriodWindows,
	fetchEntityHistory,
	periodBounds,
	periodLabel
} from '../historical-centrality.js';
import type { HistoryDeps, Neo4jLike, PgLike } from '../historical-centrality.js';

type Neo4jRecord = Array<[string, unknown]>;

function makeNeo4j(rows: Neo4jRecord[]): Neo4jLike {
	return {
		run: async () => ({
			records: rows.map((entries) => ({
				get: (key: string) => {
					for (const [k, v] of entries) if (k === key) return v;
					return undefined;
				}
			}))
		}),
		close: async () => {}
	};
}

function makePgQuery(rows: Array<{ computed_at: Date; entity_importance: unknown }>): PgLike {
	return async () => ({
		rows: rows as unknown as Array<Record<string, unknown>>,
		rowCount: rows.length
	});
}

function makeDeps(neo4j: Neo4jLike, pg: PgLike): HistoryDeps {
	return {
		getSession: () => neo4j,
		pgQuery: pg
	};
}

describe('periodLabel', () => {
	it('formats months as YYYY-MM in UTC', () => {
		assert.equal(periodLabel(new Date('2024-01-15T08:30:00Z'), 'month'), '2024-01');
		assert.equal(periodLabel(new Date('2024-12-31T23:59:59Z'), 'month'), '2024-12');
	});

	it('formats years as YYYY in UTC', () => {
		assert.equal(periodLabel(new Date('2024-06-15T08:30:00Z'), 'year'), '2024');
	});
});

describe('periodBounds', () => {
	it('returns the first-of-month and first-of-next-month for a monthly bucket', () => {
		const bounds = periodBounds(new Date('2024-03-15T08:30:00Z'), 'month');
		assert.equal(bounds.start.toISOString(), '2024-03-01T00:00:00.000Z');
		assert.equal(bounds.end.toISOString(), '2024-04-01T00:00:00.000Z');
	});

	it('returns Jan 1 and next-Jan 1 for a yearly bucket', () => {
		const bounds = periodBounds(new Date('2024-08-01T00:00:00Z'), 'year');
		assert.equal(bounds.start.toISOString(), '2024-01-01T00:00:00.000Z');
		assert.equal(bounds.end.toISOString(), '2025-01-01T00:00:00.000Z');
	});
});

describe('buildPeriodWindows', () => {
	it('produces N monthly buckets in ascending order ending with the anchor month', () => {
		const windows = buildPeriodWindows(new Date('2024-04-15T00:00:00Z'), 4, 'month');
		assert.equal(windows.length, 4);
		assert.equal(windows[0].label, '2024-01');
		assert.equal(windows[3].label, '2024-04');
	});

	it('produces N yearly buckets ending with the anchor year', () => {
		const windows = buildPeriodWindows(new Date('2024-04-15T00:00:00Z'), 3, 'year');
		assert.deepEqual(
			windows.map((w) => w.label),
			['2022', '2023', '2024']
		);
	});
});

describe('fetchEntityHistory', () => {
	describe('happy path', () => {
		it('returns one EntityHistory per requested name with mentions and centrality merged', async () => {
			// 12 monthly buckets ending 2024-04. Mentions: agents at 5 in
			// 2024-04 and 2 in 2023-04. Centrality from one snapshot in 2024-04.
			const neo4j = makeNeo4j([
				...Array.from(
					{ length: 5 },
					() =>
						[
							['name', 'agents'],
							['publishedAt', '2024-04-10T00:00:00Z']
						] as Neo4jRecord
				),
				...Array.from(
					{ length: 2 },
					() =>
						[
							['name', 'agents'],
							['publishedAt', '2023-04-15T00:00:00Z']
						] as Neo4jRecord
				)
			]);
			const pg = makePgQuery([
				{
					computed_at: new Date('2024-04-20T00:00:00Z'),
					entity_importance: [
						{
							name: 'agents',
							type: 'concept',
							pagerank_score: 0.42,
							pagerank_rank: 1,
							mention_count: 5
						}
					]
				}
			]);

			const result = await fetchEntityHistory(
				{
					entityNames: ['agents'],
					currentPeriodEnd: new Date('2024-04-15T00:00:00Z'),
					periods: 13,
					periodKind: 'month'
				},
				makeDeps(neo4j, pg)
			);

			assert.equal(result.length, 1);
			const [agents] = result;
			assert.equal(agents.entityName, 'agents');
			// 12-month delta: (5 - 2) / 2 = 1.5
			assert.equal(agents.twelveMonthDelta, 1.5);
			// Trajectory: ascending by period, with centrality 0.42 in the 2024-04 bucket
			const final = agents.trajectory[agents.trajectory.length - 1];
			assert.equal(final.period, '2024-04');
			assert.equal(final.mentions, 5);
			assert.equal(final.centrality, 0.42);
		});
	});

	describe('sparse data', () => {
		it('returns zero deltas and zero-mention buckets when Neo4j returns no records', async () => {
			const neo4j = makeNeo4j([]);
			const pg = makePgQuery([]);

			const result = await fetchEntityHistory(
				{
					entityNames: ['unknown-entity'],
					currentPeriodEnd: new Date('2024-04-15T00:00:00Z'),
					periods: 12,
					periodKind: 'month'
				},
				makeDeps(neo4j, pg)
			);

			assert.equal(result.length, 1);
			const [entity] = result;
			assert.equal(entity.twelveMonthDelta, 0);
			assert.equal(entity.yoyDelta, 0);
			// Trajectory still has 12 buckets; all zeros.
			assert.equal(entity.trajectory.length, 12);
			assert.equal(
				entity.trajectory.every((t) => t.mentions === 0 && t.centrality === 0),
				true
			);
		});

		it('returns empty array when no entities are requested', async () => {
			const neo4j = makeNeo4j([]);
			const pg = makePgQuery([]);

			const result = await fetchEntityHistory(
				{
					entityNames: [],
					currentPeriodEnd: new Date('2024-04-15T00:00:00Z'),
					periods: 12,
					periodKind: 'month'
				},
				makeDeps(neo4j, pg)
			);

			assert.deepEqual(result, []);
		});

		it('returns empty array when periods is 0', async () => {
			const neo4j = makeNeo4j([]);
			const pg = makePgQuery([]);

			const result = await fetchEntityHistory(
				{
					entityNames: ['x'],
					currentPeriodEnd: new Date('2024-04-15T00:00:00Z'),
					periods: 0,
					periodKind: 'month'
				},
				makeDeps(neo4j, pg)
			);

			assert.deepEqual(result, []);
		});
	});

	describe('YoY computation', () => {
		it('aggregates monthly buckets into calendar-year totals for yoyDelta', async () => {
			// Two mentions in Jan 2024, four mentions across Mar 2023 and Aug 2023.
			const neo4j = makeNeo4j([
				[
					['name', 'rust'],
					['publishedAt', '2024-01-15T00:00:00Z']
				] as Neo4jRecord,
				[
					['name', 'rust'],
					['publishedAt', '2024-01-20T00:00:00Z']
				] as Neo4jRecord,
				...Array.from(
					{ length: 2 },
					() =>
						[
							['name', 'rust'],
							['publishedAt', '2023-03-15T00:00:00Z']
						] as Neo4jRecord
				),
				...Array.from(
					{ length: 2 },
					() =>
						[
							['name', 'rust'],
							['publishedAt', '2023-08-01T00:00:00Z']
						] as Neo4jRecord
				)
			]);
			const pg = makePgQuery([]);

			const result = await fetchEntityHistory(
				{
					entityNames: ['rust'],
					currentPeriodEnd: new Date('2024-01-31T00:00:00Z'),
					periods: 13,
					periodKind: 'month'
				},
				makeDeps(neo4j, pg)
			);

			// 2024 total = 2, 2023 total = 4, yoy = (2-4)/4 = -0.5
			assert.equal(result[0].yoyDelta, -0.5);
		});
	});
});
