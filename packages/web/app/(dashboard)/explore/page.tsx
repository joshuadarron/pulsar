'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = dynamic(() => import('react-force-graph-2d') as any, { ssr: false }) as any;

interface GraphNode {
	id: string;
	label: string;
	kind: 'cluster' | 'topic' | 'entity';
	type: string;
	score: number;
	clusterId: number | null;
}

interface GraphLink {
	source: string;
	target: string;
	type: string;
	weight: number;
}

interface SnapshotInfo {
	id: string;
	computedAt: string;
	clusterCount: number;
	entityCount: number;
	topicCount: number;
}

// 12-color qualitative palette for Louvain clusters. Hash cluster_id into
// this list so the same cluster keeps the same color across renders.
const CLUSTER_PALETTE = [
	'#6366f1',
	'#ec4899',
	'#10b981',
	'#f59e0b',
	'#06b6d4',
	'#a855f7',
	'#ef4444',
	'#14b8a6',
	'#f97316',
	'#84cc16',
	'#8b5cf6',
	'#d946ef'
];

const ENTITY_COLOR = '#facc15';
const CLUSTER_HUB_COLOR_FALLBACK = '#9ca3af';

function colorForCluster(clusterId: number | null): string {
	if (clusterId === null || clusterId === undefined) return CLUSTER_HUB_COLOR_FALLBACK;
	const idx =
		((clusterId % CLUSTER_PALETTE.length) + CLUSTER_PALETTE.length) % CLUSTER_PALETTE.length;
	return CLUSTER_PALETTE[idx];
}

function nodeColor(node: GraphNode): string {
	if (node.kind === 'entity') return ENTITY_COLOR;
	return colorForCluster(node.clusterId);
}

function nodeRadius(node: GraphNode): number {
	if (node.kind === 'cluster') return 8 + Math.min(12, Math.sqrt(node.score));
	if (node.kind === 'entity') return 3 + Math.min(10, node.score * 40);
	return 3 + Math.min(8, Math.sqrt(Math.max(1, node.score)) / 2);
}

function formatTimestamp(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleString();
}

export default function ExplorePage() {
	const [snapshot, setSnapshot] = useState<SnapshotInfo | null>(null);
	const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({
		nodes: [],
		links: []
	});
	const [loading, setLoading] = useState(true);
	const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
	const graphRef = useRef<{ centerAt: (x: number, y: number, ms: number) => void } | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		fetch('/api/graph')
			.then((r) => r.json())
			.then((data) => {
				if (cancelled) return;
				setSnapshot(data.snapshot ?? null);
				setGraphData({ nodes: data.nodes ?? [], links: data.links ?? [] });
			})
			.catch(() => {
				if (cancelled) return;
				setSnapshot(null);
				setGraphData({ nodes: [], links: [] });
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleNodeClick = useCallback((node: GraphNode) => {
		setSelectedNode(node);
	}, []);

	const nodeCanvasObject = useCallback(
		(node: GraphNode & { x?: number; y?: number }, ctx: CanvasRenderingContext2D) => {
			const label = node.label ?? node.id;
			const radius = nodeRadius(node);

			ctx.beginPath();
			ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);
			ctx.fillStyle = nodeColor(node);
			ctx.fill();

			if (node.kind === 'cluster') {
				ctx.lineWidth = 1.5;
				ctx.strokeStyle = '#111827';
				ctx.stroke();
			}

			const showLabel = node.kind === 'cluster' || node.kind === 'entity' || radius > 6;
			if (!showLabel) return;

			ctx.font = node.kind === 'cluster' ? '4px sans-serif' : '3px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#d4d4d4' : '#1f2937';
			ctx.fillText(label.slice(0, 30), node.x!, node.y! + radius + 4);
		},
		[]
	);

	const clusterLegend = useMemo(() => {
		const seen = new Map<number, string>();
		for (const node of graphData.nodes) {
			if (node.kind !== 'cluster' || node.clusterId === null) continue;
			if (!seen.has(node.clusterId)) {
				seen.set(node.clusterId, node.label);
			}
		}
		return Array.from(seen.entries())
			.sort((a, b) => a[0] - b[0])
			.slice(0, 12);
	}, [graphData.nodes]);

	const selectedScoreLabel = useMemo(() => {
		if (!selectedNode) return null;
		if (selectedNode.kind === 'cluster') return `Topic count: ${selectedNode.score}`;
		if (selectedNode.kind === 'topic') return `Trend score: ${selectedNode.score.toFixed(2)}`;
		return `PageRank score: ${selectedNode.score.toFixed(4)}`;
	}, [selectedNode]);

	return (
		<div>
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Graph Explorer</h1>
					<p className="mt-1 text-gray-500 dark:text-neutral-400">
						Latest Louvain clusters and PageRank entity importance from the most recent graph
						snapshot
					</p>
				</div>
				{snapshot ? (
					<div className="text-right text-xs text-gray-500 dark:text-neutral-400">
						<p>
							Snapshot <code className="font-mono text-[11px]">{snapshot.id.slice(0, 8)}</code>
						</p>
						<p className="mt-0.5">{formatTimestamp(snapshot.computedAt)}</p>
						<p className="mt-0.5">
							{snapshot.clusterCount} clusters, {snapshot.topicCount} topics, {snapshot.entityCount}{' '}
							entities
						</p>
					</div>
				) : null}
			</div>

			<div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-600 dark:text-neutral-400">
				{clusterLegend.map(([clusterId, label]) => (
					<div key={clusterId} className="flex items-center gap-1.5">
						<div
							className="h-3 w-3 rounded-full"
							style={{ backgroundColor: colorForCluster(clusterId) }}
						/>
						<span className="max-w-[14rem] truncate">{label}</span>
					</div>
				))}
				{clusterLegend.length > 0 ? (
					<div className="flex items-center gap-1.5">
						<div className="h-3 w-3 rounded-full" style={{ backgroundColor: ENTITY_COLOR }} />
						<span>Entities (size by PageRank)</span>
					</div>
				) : null}
			</div>

			<div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
				<GraphCanvas
					graphRef={graphRef}
					graphData={graphData}
					nodeCanvasObject={nodeCanvasObject}
					handleNodeClick={handleNodeClick}
					loading={loading}
					hasSnapshot={snapshot !== null}
				/>

				<div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
					<h3 className="text-sm font-semibold text-gray-700 dark:text-neutral-300 uppercase">
						Node Details
					</h3>
					{selectedNode ? (
						<div className="mt-3 space-y-2">
							<p className="text-lg font-medium text-gray-900 dark:text-neutral-100">
								{selectedNode.label}
							</p>
							<p className="text-sm text-gray-500 dark:text-neutral-400">
								Kind: {selectedNode.kind}
							</p>
							{selectedNode.clusterId !== null ? (
								<p className="text-sm text-gray-500 dark:text-neutral-400">
									Cluster: {selectedNode.clusterId}
								</p>
							) : null}
							{selectedScoreLabel ? (
								<p className="text-sm text-gray-500 dark:text-neutral-400">{selectedScoreLabel}</p>
							) : null}
						</div>
					) : (
						<p className="mt-3 text-sm text-gray-400 dark:text-neutral-500">
							Click a node to see details
						</p>
					)}

					<div className="mt-6">
						<h4 className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase">
							Stats
						</h4>
						<div className="mt-2 space-y-1">
							<p className="text-sm text-gray-600 dark:text-neutral-400">
								{graphData.nodes.length} nodes
							</p>
							<p className="text-sm text-gray-600 dark:text-neutral-400">
								{graphData.links.length} edges
							</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function GraphCanvas({
	graphRef,
	graphData,
	nodeCanvasObject,
	handleNodeClick,
	loading,
	hasSnapshot
}: {
	graphRef: React.MutableRefObject<{ centerAt: (x: number, y: number, ms: number) => void } | null>;
	graphData: { nodes: GraphNode[]; links: GraphLink[] };
	nodeCanvasObject: (
		node: GraphNode & { x?: number; y?: number },
		ctx: CanvasRenderingContext2D
	) => void;
	handleNodeClick: (node: GraphNode) => void;
	loading: boolean;
	hasSnapshot: boolean;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(600);

	useEffect(() => {
		if (!containerRef.current) return;
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				setWidth(entry.contentRect.width);
			}
		});
		observer.observe(containerRef.current);
		setWidth(containerRef.current.clientWidth);
		return () => observer.disconnect();
	}, []);

	const emptyMessage = loading
		? 'Loading latest snapshot...'
		: hasSnapshot
			? 'Snapshot has no data. Trigger a pipeline run to recompute.'
			: 'No graph snapshot yet. Trigger a pipeline run to compute one.';

	return (
		<div
			ref={containerRef}
			className="lg:col-span-2 overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
			style={{ height: 600 }}
		>
			{graphData.nodes.length > 0 ? (
				<ForceGraph2D
					ref={graphRef as React.MutableRefObject<null>}
					graphData={graphData}
					nodeId="id"
					nodeCanvasObject={nodeCanvasObject}
					onNodeClick={handleNodeClick}
					linkColor={() =>
						document.documentElement.classList.contains('dark') ? '#404040' : '#e5e7eb'
					}
					linkWidth={(link: { weight?: number }) => Math.sqrt((link.weight as number) || 1)}
					width={width}
					height={600}
				/>
			) : (
				<div className="flex h-full items-center justify-center text-gray-400 dark:text-neutral-500">
					{emptyMessage}
				</div>
			)}
		</div>
	);
}
