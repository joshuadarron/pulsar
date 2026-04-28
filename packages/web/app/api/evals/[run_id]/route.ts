import { type NextRequest, NextResponse } from 'next/server';
import { query } from '@pulsar/shared/db/postgres';

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ run_id: string }> }
) {
	const { run_id } = await params;

	const [runRow, validations, evaluations, predictions] = await Promise.all([
		query<{
			id: string;
			started_at: string;
			completed_at: string | null;
			status: string;
			run_type: string;
			trigger: string;
		}>('SELECT id, started_at, completed_at, status, run_type, trigger FROM runs WHERE id = $1', [
			run_id
		]),
		query<{
			id: string;
			pipeline_name: string;
			validated_at: string;
			passed: boolean;
			checks: { check_name: string; passed: boolean; detail?: string }[];
			error_summary: string | null;
		}>(
			'SELECT id, pipeline_name, validated_at, passed, checks, error_summary FROM pipeline_validations WHERE run_id = $1 ORDER BY validated_at',
			[run_id]
		),
		query<{
			id: string;
			target_type: string;
			target_id: string | null;
			dimension: string;
			score: number | null;
			passed: boolean | null;
			rationale: string | null;
			judge_model: string;
			judged_at: string;
		}>(
			`SELECT id, target_type, target_id, dimension, score, passed, rationale, judge_model, judged_at
			 FROM evaluations WHERE run_id = $1 ORDER BY target_type, target_id, dimension`,
			[run_id]
		),
		query<{
			id: string;
			report_id: string;
			prediction_text: string;
			predicted_entities: string[];
			predicted_topics: string[];
			prediction_type: string;
			extracted_at: string;
			outcome: string | null;
			evidence_summary: string | null;
			grade_judge_model: string | null;
		}>(
			`SELECT p.id, p.report_id, p.prediction_text, p.predicted_entities, p.predicted_topics,
				p.prediction_type, p.extracted_at,
				g.outcome, g.evidence_summary, g.judge_model AS grade_judge_model
			 FROM report_predictions p
			 JOIN reports r ON r.id = p.report_id
			 LEFT JOIN retrospective_grades g ON g.prediction_id = p.id
			 WHERE r.run_id = $1
			 ORDER BY p.extracted_at`,
			[run_id]
		)
	]);

	if (runRow.rows.length === 0) {
		return NextResponse.json({ error: 'Run not found' }, { status: 404 });
	}

	return NextResponse.json({
		run: runRow.rows[0],
		validations: validations.rows,
		evaluations: evaluations.rows,
		predictions: predictions.rows
	});
}
