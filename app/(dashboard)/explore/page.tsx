"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = dynamic(() => import("react-force-graph-2d") as any, { ssr: false }) as any;

interface GraphNode {
  id: string;
  label: string;
  type: string;
  score: number;
}

interface GraphLink {
  source: string;
  target: string;
  type: string;
  weight: number;
}

const NODE_TYPES = ["Topic", "Entity", "Article", "Author", "Source"];
const TYPE_COLORS: Record<string, string> = {
  Topic: "#6366f1",
  Entity: "#ec4899",
  Article: "#f59e0b",
  Author: "#10b981",
  Source: "#06b6d4",
  Unknown: "#9ca3af",
};

export default function ExplorePage() {
  const [nodeType, setNodeType] = useState("Topic");
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const graphRef = useRef<{ centerAt: (x: number, y: number, ms: number) => void } | null>(null);

  useEffect(() => {
    fetch(`/api/graph?type=${nodeType}&limit=100`)
      .then((r) => r.json())
      .then(setGraphData);
  }, [nodeType]);

  const handleNodeClick = useCallback((node: { id?: string; label?: string; type?: string; score?: number }) => {
    setSelectedNode(node as GraphNode);
  }, []);

  const nodeCanvasObject = useCallback(
    (node: { x?: number; y?: number; id?: string; label?: string; type?: string; score?: number }, ctx: CanvasRenderingContext2D) => {
      const label = (node.label || node.id || "") as string;
      const type = (node.type || "Unknown") as string;
      const size = 4 + Math.min(12, Math.sqrt((node.score as number) || 1));

      ctx.beginPath();
      ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI);
      ctx.fillStyle = TYPE_COLORS[type] || TYPE_COLORS.Unknown;
      ctx.fill();

      ctx.font = "3px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#374151";
      ctx.fillText(label.slice(0, 20), node.x!, node.y! + size + 4);
    },
    [],
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Graph Explorer</h1>
          <p className="mt-1 text-gray-500 dark:text-neutral-400">Explore relationships between topics, entities, and articles</p>
        </div>
        <select
          value={nodeType}
          onChange={(e) => setNodeType(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-neutral-600 px-3 py-2 text-sm"
        >
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>{t}s</option>
          ))}
        </select>
      </div>

      <div className="mt-4 flex gap-3">
        {Object.entries(TYPE_COLORS).filter(([k]) => k !== "Unknown").map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-xs text-gray-600 dark:text-neutral-400">{type}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900" style={{ height: 600 }}>
          {graphData.nodes.length > 0 ? (
            <ForceGraph2D
              ref={graphRef as React.MutableRefObject<null>}
              graphData={graphData}
              nodeId="id"
              nodeCanvasObject={nodeCanvasObject}
              onNodeClick={handleNodeClick}
              linkColor={() => "#e5e7eb"}
              linkWidth={(link: { weight?: number }) => Math.sqrt((link.weight as number) || 1)}
              width={800}
              height={600}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400 dark:text-neutral-500">
              No graph data available. Run a scrape first.
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-neutral-300 uppercase">Node Details</h3>
          {selectedNode ? (
            <div className="mt-3 space-y-2">
              <p className="text-lg font-medium text-gray-900 dark:text-neutral-100">{selectedNode.label}</p>
              <p className="text-sm text-gray-500 dark:text-neutral-400">Type: {selectedNode.type}</p>
              {selectedNode.score > 0 && (
                <p className="text-sm text-gray-500 dark:text-neutral-400">Score: {selectedNode.score.toFixed(2)}</p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-400 dark:text-neutral-500">Click a node to see details</p>
          )}

          <div className="mt-6">
            <h4 className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase">Stats</h4>
            <div className="mt-2 space-y-1">
              <p className="text-sm text-gray-600 dark:text-neutral-400">{graphData.nodes.length} nodes</p>
              <p className="text-sm text-gray-600 dark:text-neutral-400">{graphData.links.length} relationships</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
