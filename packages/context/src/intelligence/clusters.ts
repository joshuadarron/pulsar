import { getSession } from '@pulsar/shared/db/neo4j';

import type { IntelligenceTopicCluster } from '../types.js';
import type { Neo4jSessionLike, SnapshotResolution } from './snapshot.js';

const DEFAULT_TOP_CLUSTERS = 6;
const DEFAULT_TOP_TOPICS_PER_CLUSTER = 10;

export type LoadClustersOptions = {
	topClusters?: number;
	topTopicsPerCluster?: number;
	getSession?: () => Neo4jSessionLike;
};

/**
 * Build the topic-cluster view from a snapshot. Reads `topic_clusters` from
 * the snapshot (an array of `{ cluster_id, topics, topic_count }`), keeps the
 * top N clusters by `topic_count`, and within each cluster surfaces the top
 * topics by `trend_score`.
 *
 * If a Neo4j session is available we re-rank topics by their current
 * `trendScore` from the live graph. Otherwise we fall back to the
 * `trend_score` baked into the snapshot when it was computed.
 */
export async function loadTopicClusters(
	snapshot: SnapshotResolution,
	opts: LoadClustersOptions = {}
): Promise<IntelligenceTopicCluster[]> {
	const topClusters = opts.topClusters ?? DEFAULT_TOP_CLUSTERS;
	const topTopicsPerCluster = opts.topTopicsPerCluster ?? DEFAULT_TOP_TOPICS_PER_CLUSTER;
	if (topClusters <= 0) return [];

	const clusters = snapshot.snapshot.topicClusters
		.slice()
		.sort((a, b) => b.topic_count - a.topic_count)
		.slice(0, topClusters);

	if (clusters.length === 0) return [];

	const sessionFactory = opts.getSession ?? (() => getSession() as unknown as Neo4jSessionLike);
	let liveScores: Map<string, number> | null = null;
	const allNames = new Set<string>();
	for (const cluster of clusters) {
		for (const topic of cluster.topics) allNames.add(topic.name);
	}

	if (allNames.size > 0) {
		try {
			liveScores = await fetchLiveTrendScores(sessionFactory, [...allNames]);
		} catch {
			liveScores = null;
		}
	}

	return clusters.map((cluster) => {
		const ranked = cluster.topics
			.map((t) => ({
				name: t.name,
				score: liveScores?.get(t.name) ?? t.trend_score ?? 0
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, topTopicsPerCluster)
			.map((t) => t.name);

		return {
			clusterId: cluster.cluster_id,
			nodeCount: cluster.topic_count,
			topTopics: ranked
		};
	});
}

async function fetchLiveTrendScores(
	sessionFactory: () => Neo4jSessionLike,
	names: string[]
): Promise<Map<string, number>> {
	const session = sessionFactory();
	const out = new Map<string, number>();
	try {
		const result = await session.run(
			`MATCH (t:Topic) WHERE t.name IN $names
			 RETURN t.name AS name, t.trendScore AS trendScore`,
			{ names }
		);
		for (const record of result.records) {
			const name = record.get('name') as string;
			const score = record.get('trendScore');
			out.set(
				name,
				typeof score === 'object' && score !== null && 'toNumber' in score
					? (score as { toNumber(): number }).toNumber()
					: Number(score ?? 0)
			);
		}
	} finally {
		await session.close();
	}
	return out;
}
