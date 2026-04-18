import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/db/neo4j";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const nodeType = searchParams.get("type") || "Topic";
  const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);

  const session = getSession();
  try {
    // Get nodes and their relationships
    const result = await session.run(
      `MATCH (n:${nodeType})
       OPTIONAL MATCH (n)-[r]-(m)
       WITH n, collect(DISTINCT {
         target: coalesce(m.name, m.title, m.handle, id(m)),
         targetType: labels(m)[0],
         relType: type(r),
         weight: coalesce(r.weight, r.count, 1)
       }) AS rels
       RETURN n, rels
       ORDER BY coalesce(n.trendScore, 0) DESC
       LIMIT $limit`,
      { limit },
    );

    const nodesMap = new Map<string, { id: string; label: string; type: string; score: number }>();
    const links: { source: string; target: string; type: string; weight: number }[] = [];

    for (const record of result.records) {
      const node = record.get("n");
      const props = node.properties;
      const id = props.name || props.title || props.handle || String(node.identity);
      const type = node.labels[0];

      nodesMap.set(id, {
        id,
        label: id,
        type,
        score: props.trendScore || props.score || 0,
      });

      const rels = record.get("rels") as Array<{
        target: string;
        targetType: string;
        relType: string;
        weight: number;
      }>;

      for (const rel of rels) {
        if (!rel.target || !rel.relType) continue;

        nodesMap.set(String(rel.target), {
          id: String(rel.target),
          label: String(rel.target),
          type: rel.targetType || "Unknown",
          score: 0,
        });

        links.push({
          source: id,
          target: String(rel.target),
          type: rel.relType,
          weight: typeof rel.weight === "object"
            ? (rel.weight as { toNumber(): number }).toNumber()
            : (rel.weight || 1),
        });
      }
    }

    return NextResponse.json({
      nodes: Array.from(nodesMap.values()),
      links,
    });
  } finally {
    await session.close();
  }
}
