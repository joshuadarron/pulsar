import { NextResponse } from 'next/server';
import { query } from '@pulsar/shared/db/postgres';

export async function GET() {
	const result = await query(
		`SELECT id, generated_at, period_start, period_end, article_count,
            report_data->'sections'->'executiveSummary'->>'text' AS executive_summary
     FROM reports ORDER BY generated_at DESC`
	);
	return NextResponse.json(result.rows);
}
