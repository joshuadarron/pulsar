import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GraphSnapshotCluster } from '@pulsar/shared/types';

import { loadTopicClusters } from '../clusters.js';
import type { Neo4jSessionLike, SnapshotResolution } from '../snapshot.js';

const clusters: GraphSnapshotCluster[] = [
	{
		cluster_id: 1,
		topic_count: 30,
		topics: [
			{ name: 'agents', trend_score: 9 },
			{ name: 'rag', trend_score: 5 },
			{ name: 'mcp', trend_score: 1 }
		]
	},
	{
		cluster_id: 2,
		topic_count: 5,
		topics: [{ name: 'rust', trend_score: 3 }]
	}
];

function makeSnapshot(): SnapshotResolution {
	return {
		snapshot: { id: 'snap-1', topicClusters: clusters, entityImportance: [] },
		source: 'cached'
	};
}

function makeSession(rows: Array<Record<string, unknown>> = []): Neo4jSessionLike {
	return {
		run: async () => ({
			records: rows.map((r) => ({ get: (k: string) => r[k] }))
		}),
		close: async () => {}
	};
}

describe('loadTopicClusters', () => {
	it('returns clusters sorted by node count and the top topics within each', async () => {
		const result = await loadTopicClusters(makeSnapshot(), {
			getSession: () =>
				makeSession([
					{ name: 'agents', trendScore: 9 },
					{ name: 'rag', trendScore: 5 },
					{ name: 'mcp', trendScore: 1 },
					{ name: 'rust', trendScore: 3 }
				]),
			topClusters: 5,
			topTopicsPerCluster: 2
		});

		assert.equal(result.length, 2);
		assert.equal(result[0].clusterId, 1);
		assert.equal(result[0].nodeCount, 30);
		assert.deepEqual(result[0].topTopics, ['agents', 'rag']);
		assert.equal(result[1].clusterId, 2);
		assert.deepEqual(result[1].topTopics, ['rust']);
	});

	it('falls back to snapshot trend scores if Neo4j is unavailable', async () => {
		const erroringSession: Neo4jSessionLike = {
			run: async () => {
				throw new Error('neo4j down');
			},
			close: async () => {}
		};
		const result = await loadTopicClusters(makeSnapshot(), {
			getSession: () => erroringSession,
			topClusters: 1,
			topTopicsPerCluster: 1
		});
		assert.equal(result.length, 1);
		assert.deepEqual(result[0].topTopics, ['agents']);
	});

	it('returns empty when there are no clusters', async () => {
		const empty: SnapshotResolution = {
			snapshot: { id: 'x', topicClusters: [], entityImportance: [] },
			source: 'cached'
		};
		const result = await loadTopicClusters(empty);
		assert.deepEqual(result, []);
	});
});
