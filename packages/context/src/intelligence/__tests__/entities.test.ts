import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GraphSnapshotEntity } from '@pulsar/shared/types';

import { loadEntities } from '../entities.js';
import type { SnapshotResolution } from '../snapshot.js';

function makeSnapshot(entities: GraphSnapshotEntity[]): SnapshotResolution {
	return {
		snapshot: { id: 'snap-1', topicClusters: [], entityImportance: entities },
		source: 'cached'
	};
}

const window = {
	start: new Date('2026-04-01T00:00:00Z'),
	end: new Date('2026-05-01T00:00:00Z')
};

const sample: GraphSnapshotEntity[] = Array.from({ length: 5 }, (_, i) => ({
	name: `entity-${i}`,
	type: 'concept',
	pagerank_score: 1 - i * 0.1,
	pagerank_rank: i + 1,
	mention_count: 100 - i * 10
}));

describe('loadEntities', () => {
	it('maps snapshot rows to typed entities and respects topN', async () => {
		const entities = await loadEntities(window, makeSnapshot(sample), { topN: 3 });
		assert.equal(entities.length, 3);
		assert.deepEqual(entities[0], {
			name: 'entity-0',
			type: 'concept',
			pagerankScore: 1,
			pagerankRank: 1,
			mentionCount: 100
		});
	});

	it('returns an empty array when the snapshot has no entities', async () => {
		const entities = await loadEntities(window, makeSnapshot([]));
		assert.deepEqual(entities, []);
	});

	it('returns an empty array when topN is zero', async () => {
		const entities = await loadEntities(window, makeSnapshot(sample), { topN: 0 });
		assert.deepEqual(entities, []);
	});

	it('does not call the history fetcher when includeHistory is false', async () => {
		let fetcherCalls = 0;
		const entities = await loadEntities(window, makeSnapshot(sample), {
			includeHistory: false,
			historyFetcher: async () => {
				fetcherCalls++;
				return [];
			}
		});
		assert.equal(fetcherCalls, 0);
		assert.equal(
			entities.every((e) => e.history === undefined),
			true
		);
	});

	it('attaches history when the fetcher returns matching records', async () => {
		const entities = await loadEntities(window, makeSnapshot(sample.slice(0, 2)), {
			includeHistory: true,
			historyFetcher: async (q) => {
				assert.deepEqual(q.entityNames, ['entity-0', 'entity-1']);
				return [
					{
						entityName: 'entity-0',
						twelveMonthDelta: 1.5,
						yoyDelta: 0.2,
						trajectory: []
					},
					{
						entityName: 'entity-1',
						twelveMonthDelta: 0,
						yoyDelta: 0,
						trajectory: []
					}
				];
			}
		});
		assert.equal(entities.length, 2);
		assert.equal(entities[0].history?.twelveMonthDelta, 1.5);
		assert.equal(entities[1].history?.yoyDelta, 0);
	});

	it('soft-fails to plain entities when the history fetcher throws', async () => {
		let warned: string | undefined;
		const entities = await loadEntities(window, makeSnapshot(sample.slice(0, 2)), {
			includeHistory: true,
			historyFetcher: async () => {
				throw new Error('neo4j down');
			},
			warn: (msg) => {
				warned = msg;
			}
		});
		assert.equal(entities.length, 2);
		assert.equal(
			entities.every((e) => e.history === undefined),
			true
		);
		assert.match(warned ?? '', /fetcher failed/);
	});
});
