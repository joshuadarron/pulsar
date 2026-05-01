import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { enrichEntitiesWithHistory } from '@pulsar/scraper/analytics';
import type { EntityHistory, EntityHistoryQuery } from '@pulsar/scraper/analytics';
import type { GraphSnapshotEntity } from '@pulsar/shared/types';

function makeEntity(
	name: string,
	overrides: Partial<GraphSnapshotEntity> = {}
): GraphSnapshotEntity {
	return {
		name,
		type: 'concept',
		pagerank_score: 0.1,
		pagerank_rank: 1,
		mention_count: 10,
		...overrides
	};
}

describe('enrichEntitiesWithHistory', () => {
	describe('happy path', () => {
		it('attaches history to each entity for which the fetcher returns a record', async () => {
			const entities = [makeEntity('agents'), makeEntity('mcp')];
			const fetcher = async (_q: EntityHistoryQuery): Promise<EntityHistory[]> => [
				{
					entityName: 'agents',
					twelveMonthDelta: 1.2,
					yoyDelta: 0.5,
					trajectory: [{ period: '2024-04', mentions: 5, centrality: 0.4 }]
				},
				{
					entityName: 'mcp',
					twelveMonthDelta: 0,
					yoyDelta: 0,
					trajectory: [{ period: '2024-04', mentions: 1, centrality: 0.05 }]
				}
			];

			const out = await enrichEntitiesWithHistory(entities, fetcher, {
				currentPeriodEnd: new Date('2024-04-15T00:00:00Z'),
				periods: 12,
				periodKind: 'month'
			});

			assert.equal(out.length, 2);
			assert.equal(out[0].name, 'agents');
			assert.deepEqual(out[0].history, {
				twelveMonthDelta: 1.2,
				yoyDelta: 0.5,
				trajectory: [{ period: '2024-04', mentions: 5, centrality: 0.4 }]
			});
			assert.equal(out[1].name, 'mcp');
			assert.equal(out[1].history?.trajectory.length, 1);
		});

		it('passes the entity names to the fetcher in the same order as the input', async () => {
			const entities = [makeEntity('a'), makeEntity('b'), makeEntity('c')];
			let receivedNames: string[] = [];
			const fetcher = async (q: EntityHistoryQuery): Promise<EntityHistory[]> => {
				receivedNames = q.entityNames;
				return [];
			};

			await enrichEntitiesWithHistory(entities, fetcher, {
				currentPeriodEnd: new Date(),
				periods: 12,
				periodKind: 'month'
			});

			assert.deepEqual(receivedNames, ['a', 'b', 'c']);
		});

		it('omits the history field when the fetcher has no record for that entity', async () => {
			const entities = [makeEntity('agents'), makeEntity('forgotten')];
			const fetcher = async (): Promise<EntityHistory[]> => [
				{
					entityName: 'agents',
					twelveMonthDelta: 0.1,
					yoyDelta: 0.0,
					trajectory: []
				}
			];

			const out = await enrichEntitiesWithHistory(entities, fetcher, {
				currentPeriodEnd: new Date(),
				periods: 12,
				periodKind: 'month'
			});

			assert.equal(out[0].history?.twelveMonthDelta, 0.1);
			assert.equal(out[1].history, undefined);
		});
	});

	describe('failure handling', () => {
		it('returns plain entities and logs a warning when the fetcher throws', async () => {
			const entities = [makeEntity('agents')];
			const fetcher = async (): Promise<EntityHistory[]> => {
				throw new Error('neo4j down');
			};
			const warnings: string[] = [];

			const out = await enrichEntitiesWithHistory(entities, fetcher, {
				currentPeriodEnd: new Date(),
				periods: 12,
				periodKind: 'month',
				warn: (msg) => {
					warnings.push(msg);
				}
			});

			assert.equal(out.length, 1);
			assert.equal(out[0].history, undefined);
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /neo4j down/);
		});

		it('returns an empty array when given an empty list of entities (no fetcher call)', async () => {
			let fetcherCalls = 0;
			const fetcher = async (): Promise<EntityHistory[]> => {
				fetcherCalls++;
				return [];
			};

			const out = await enrichEntitiesWithHistory([], fetcher, {
				currentPeriodEnd: new Date(),
				periods: 12,
				periodKind: 'month'
			});

			assert.deepEqual(out, []);
			assert.equal(fetcherCalls, 0);
		});
	});
});
