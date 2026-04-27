import { NextRequest, NextResponse } from "next/server";
import { query } from "@pulsar/shared/db/postgres";

interface RecentRunRow {
	run_id: string;
	started_at: string;
	completed_at: string | null;
	status: string;
	report_total: number | null;
	report_max: number | null;
	drafts_avg_llm: number | null;
	drafts_count: number;
	validations_passed: number;
	validations_failed: number;
}

export async function GET(request: NextRequest) {
	const url = request.nextUrl;
	const days = parseInt(url.searchParams.get("days") || "30");

	const result = await query<RecentRunRow>(
		`WITH recent_runs AS (
			SELECT id AS run_id, started_at, completed_at, status
			FROM runs
			WHERE run_type = 'pipeline' AND started_at > now() - ($1::int || ' days')::interval
		),
		report_scores AS (
			SELECT run_id,
				SUM(score)::int AS total,
				(COUNT(*) FILTER (WHERE score IS NOT NULL))::int * 5 AS max
			FROM evaluations
			WHERE target_type = 'trend_report' AND score IS NOT NULL
			GROUP BY run_id
		),
		draft_scores AS (
			SELECT run_id,
				AVG(score)::numeric(10,2) AS avg_score,
				COUNT(DISTINCT target_id)::int AS count
			FROM evaluations
			WHERE target_type = 'content_draft' AND score IS NOT NULL
			GROUP BY run_id
		),
		validation_counts AS (
			SELECT run_id,
				COUNT(*) FILTER (WHERE passed = true)::int AS passed,
				COUNT(*) FILTER (WHERE passed = false)::int AS failed
			FROM pipeline_validations
			GROUP BY run_id
		)
		SELECT r.run_id, r.started_at, r.completed_at, r.status,
			rs.total AS report_total, rs.max AS report_max,
			ds.avg_score AS drafts_avg_llm, COALESCE(ds.count, 0) AS drafts_count,
			COALESCE(vc.passed, 0) AS validations_passed,
			COALESCE(vc.failed, 0) AS validations_failed
		FROM recent_runs r
		LEFT JOIN report_scores rs ON rs.run_id = r.run_id
		LEFT JOIN draft_scores ds ON ds.run_id = r.run_id
		LEFT JOIN validation_counts vc ON vc.run_id = r.run_id
		ORDER BY r.started_at DESC`,
		[days],
	);

	return NextResponse.json({ runs: result.rows, days });
}
