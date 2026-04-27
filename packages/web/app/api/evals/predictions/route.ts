import { NextRequest, NextResponse } from "next/server";
import { query } from "@pulsar/shared/db/postgres";

const VALID_OUTCOMES = new Set([
	"confirmed",
	"partially_confirmed",
	"refuted",
	"inconclusive",
	"pending",
]);

export async function GET(request: NextRequest) {
	const url = request.nextUrl;
	const outcomeFilter = url.searchParams.get("outcome");
	const limit = parseInt(url.searchParams.get("limit") || "200");

	const where: string[] = [];
	const params: unknown[] = [];

	if (outcomeFilter && VALID_OUTCOMES.has(outcomeFilter)) {
		if (outcomeFilter === "pending") {
			where.push("g.id IS NULL AND r.generated_at > now() - interval '14 days'");
		} else {
			params.push(outcomeFilter);
			where.push(`g.outcome = $${params.length}`);
		}
	}

	params.push(limit);
	const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

	const result = await query<{
		prediction_id: string;
		report_id: string;
		report_generated_at: string;
		prediction_text: string;
		predicted_entities: string[];
		predicted_topics: string[];
		prediction_type: string;
		outcome: string | null;
		evidence_summary: string | null;
		graded_at: string | null;
		status: string;
	}>(
		`SELECT
			p.id AS prediction_id,
			p.report_id,
			r.generated_at AS report_generated_at,
			p.prediction_text,
			COALESCE(p.predicted_entities, '{}') AS predicted_entities,
			COALESCE(p.predicted_topics, '{}') AS predicted_topics,
			p.prediction_type,
			g.outcome,
			g.evidence_summary,
			g.graded_at,
			CASE
				WHEN g.outcome IS NOT NULL THEN g.outcome
				WHEN r.generated_at > now() - interval '14 days' THEN 'pending'
				ELSE 'inconclusive'
			END AS status
		 FROM report_predictions p
		 JOIN reports r ON r.id = p.report_id
		 LEFT JOIN retrospective_grades g ON g.prediction_id = p.id
		 ${whereSql}
		 ORDER BY r.generated_at DESC
		 LIMIT $${params.length}`,
		params,
	);

	return NextResponse.json({ predictions: result.rows });
}
