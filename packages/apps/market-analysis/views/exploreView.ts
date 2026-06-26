import { query } from '@pulsar/shared/db/postgres';
import type { GraphSnapshotCluster, GraphSnapshotEntity } from '@pulsar/shared/types';
import {
	type GraphLink,
	type GraphNode,
	type ViewModel,
	emptyState,
	graph,
	section,
	view
} from '@pulsar/view-model';

export const EXPLORE_VIEW_ID = 'market-analysis.explore';

interface SnapshotRow {
	id: string;
	computed_at: Date | string;
	topic_clusters: unknown;
	entity_importance: unknown;
}

async function loadLatestSnapshot(): Promise<{
	snapshot: {
		id: string;
		computedAt: string;
		clusterCount: number;
		topicCount: number;
		entityCount: number;
	} | null;
	nodes: GraphNode[];
	links: GraphLink[];
}> {
	const result = await query<SnapshotRow>(
		'SELECT id, computed_at, topic_clusters, entity_importance FROM graph_snapshots ORDER BY computed_at DESC LIMIT 1'
	);

	const row = result.rows[0];
	if (!row) return { snapshot: null, nodes: [], links: [] };

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
			group: `cluster-${cluster.cluster_id}`,
			size: cluster.topic_count
		});
		for (const topic of cluster.topics) {
			const topicId = `topic:${cluster.cluster_id}:${topic.name}`;
			nodes.push({
				id: topicId,
				label: topic.name,
				group: `cluster-${cluster.cluster_id}`,
				size: topic.trend_score
			});
			links.push({ source: topicId, target: hubId, weight: Math.max(1, topic.trend_score) });
		}
	}

	for (const entity of entityImportance) {
		nodes.push({
			id: `entity:${entity.name}`,
			label: entity.name,
			group: 'entity',
			size: entity.pagerank_score
		});
	}

	const computedAt =
		row.computed_at instanceof Date ? row.computed_at.toISOString() : String(row.computed_at);

	return {
		snapshot: {
			id: row.id,
			computedAt,
			clusterCount: topicClusters.length,
			topicCount: topicClusters.reduce((sum, c) => sum + c.topic_count, 0),
			entityCount: entityImportance.length
		},
		nodes,
		links
	};
}

export async function buildExploreView(): Promise<ViewModel> {
	const { snapshot, nodes, links } = await loadLatestSnapshot();

	if (!snapshot || nodes.length === 0) {
		return view(
			EXPLORE_VIEW_ID,
			[
				emptyState(
					'No graph snapshot yet.',
					'Trigger a pipeline run to compute Louvain clusters and PageRank entity importance.'
				)
			],
			{ title: 'Graph Explorer' }
		);
	}

	const subtitle = `Snapshot ${snapshot.id.slice(0, 8)} from ${new Date(snapshot.computedAt).toLocaleString()}: ${snapshot.clusterCount} clusters, ${snapshot.topicCount} topics, ${snapshot.entityCount} entities`;

	return view(EXPLORE_VIEW_ID, [section(undefined, [graph(nodes, links, 600)], { subtitle })], {
		title: 'Graph Explorer',
		meta: {
			snapshotId: snapshot.id,
			computedAt: snapshot.computedAt,
			clusterCount: snapshot.clusterCount,
			topicCount: snapshot.topicCount,
			entityCount: snapshot.entityCount
		}
	});
}
