import { NextResponse } from 'next/server';
import { query } from '@pulsar/shared/db/postgres';
import type { GraphSnapshotCluster, GraphSnapshotEntity } from '@pulsar/shared/types';

// Renders the latest `graph_snapshots` row (Louvain + PageRank output) as a
// force-graph payload. The old node-type-filtered view (Topic / Entity /
// Article / Author / Source) was replaced because the snapshot is the
// authoritative analytical artifact and the live Neo4j scan did not surface
// cluster membership or pagerank rank.
//
// Shape:
//   - One hub node per Louvain cluster (id `cluster-<n>`), labelled with the
//     top topic's name, sized by its topic_count.
//   - One topic node per topic in each cluster, sized by trend_score, linked
//     to the parent cluster hub.
//   - One entity node per entity in the snapshot's entity_importance list,
//     sized by pagerank_score. Entities are not linked to clusters because
//     the snapshot does not record that relationship.
//
// Returns `{ snapshot: null }` when no snapshot row exists yet so the UI can
// render an empty state.

interface SnapshotRow {
	id: string;
	computed_at: Date | string;
	topic_clusters: unknown;
	entity_importance: unknown;
}

type GraphNode = {
	id: string;
	label: string;
	kind: 'cluster' | 'topic' | 'entity';
	type: string;
	score: number;
	clusterId: number | null;
};

type GraphLink = {
	source: string;
	target: string;
	type: string;
	weight: number;
};

export async function GET() {
	try {
		const result = await query<SnapshotRow>(
			`SELECT id, computed_at, topic_clusters, entity_importance
			 FROM graph_snapshots
			 ORDER BY computed_at DESC
			 LIMIT 1`
		);

		const row = result.rows[0];
		if (!row) {
			return NextResponse.json({ snapshot: null, nodes: [], links: [] });
		}

		const topicClusters: GraphSnapshotCluster[] = Array.isArray(row.topic_clusters)
			? (row.topic_clusters as GraphSnapshotCluster[])
			: [];
		const entityImportance: GraphSnapshotEntity[] = Array.isArray(row.entity_importance)
			? (row.entity_importance as GraphSnapshotEntity[])
			: [];

		const nodes: GraphNode[] = [];
		const links: GraphLink[] = [];

		for (const cluster of topicClusters) {
			const hubId = `cluster-${cluster.cluster_id}`;
			const top = cluster.topics[0]?.name ?? `Cluster ${cluster.cluster_id}`;
			nodes.push({
				id: hubId,
				label: `Cluster ${cluster.cluster_id}: ${top}`,
				kind: 'cluster',
				type: 'Cluster',
				score: cluster.topic_count,
				clusterId: cluster.cluster_id
			});

			for (const topic of cluster.topics) {
				const topicId = `topic:${cluster.cluster_id}:${topic.name}`;
				nodes.push({
					id: topicId,
					label: topic.name,
					kind: 'topic',
					type: 'Topic',
					score: topic.trend_score,
					clusterId: cluster.cluster_id
				});
				links.push({
					source: topicId,
					target: hubId,
					type: 'MEMBER_OF',
					weight: Math.max(1, topic.trend_score)
				});
			}
		}

		for (const entity of entityImportance) {
			nodes.push({
				id: `entity:${entity.name}`,
				label: entity.name,
				kind: 'entity',
				type: entity.type || 'Entity',
				score: entity.pagerank_score,
				clusterId: null
			});
		}

		const computedAt =
			row.computed_at instanceof Date ? row.computed_at.toISOString() : String(row.computed_at);

		return NextResponse.json({
			snapshot: {
				id: row.id,
				computedAt,
				clusterCount: topicClusters.length,
				entityCount: entityImportance.length,
				topicCount: topicClusters.reduce((sum, c) => sum + c.topic_count, 0)
			},
			nodes,
			links
		});
	} catch (err) {
		console.error('[Graph API] Error:', err);
		return NextResponse.json({ error: String(err) }, { status: 500 });
	}
}
