import { type NextRequest, NextResponse } from 'next/server';
import { query } from '@pulsar/shared/db/postgres';

export async function GET(request: NextRequest) {
	const url = request.nextUrl;
	const days = Number.parseInt(url.searchParams.get('days') || '90');

	const [reportTrend, draftPlatformPass, validationFailures] = await Promise.all([
		query<{ judged_at: string; dimension: string; score: number }>(
			`SELECT judged_at, dimension, score
			 FROM evaluations
			 WHERE target_type = 'trend_report'
			   AND score IS NOT NULL
			   AND judged_at > now() - ($1::int || ' days')::interval
			 ORDER BY judged_at`,
			[days]
		),
		query<{ platform: string; total: number; passed: number }>(
			`SELECT target_id AS platform,
				COUNT(*)::int AS total,
				COUNT(*) FILTER (WHERE passed = true)::int AS passed
			 FROM evaluations
			 WHERE target_type = 'content_draft'
			   AND target_id IS NOT NULL
			   AND passed IS NOT NULL
			   AND judged_at > now() - interval '30 days'
			 GROUP BY target_id
			 ORDER BY target_id`
		),
		query<{ pipeline_name: string; failures: number }>(
			`SELECT pipeline_name, COUNT(*) FILTER (WHERE passed = false)::int AS failures
			 FROM pipeline_validations
			 WHERE validated_at > now() - interval '30 days'
			 GROUP BY pipeline_name
			 ORDER BY pipeline_name`
		)
	]);

	return NextResponse.json({
		reportTrend: reportTrend.rows,
		draftPlatformPass: draftPlatformPass.rows,
		validationFailures: validationFailures.rows,
		days
	});
}
