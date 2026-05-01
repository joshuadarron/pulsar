import { query } from '@pulsar/shared/db/postgres';
import { NextResponse } from 'next/server';

/**
 * Returns reports that have at least one content draft, grouped with summary
 * counts and the report's top opportunity (the first interpretation's
 * `meaning` field of the linked report's `signalInterpretation` section).
 *
 * Phase 6 list page consumes this endpoint, but the server-rendered list page
 * also queries the DB directly, so this endpoint is the public-API form of
 * the same data shape for any future client consumers.
 */

interface GroupedDraftsRow {
	report_id: string;
	generated_at: Date;
	top_meaning: string | null;
	draft_count: string;
	platform_count: string;
}

export async function GET() {
	const result = await query<GroupedDraftsRow>(
		`SELECT
			r.id AS report_id,
			r.generated_at,
			r.report_data->'sections'->'signalInterpretation'->'interpretations'->0->>'meaning' AS top_meaning,
			COUNT(d.id) AS draft_count,
			COUNT(DISTINCT d.platform) AS platform_count
		FROM reports r
		JOIN content_drafts d ON d.report_id = r.id
		GROUP BY r.id, r.generated_at, top_meaning
		ORDER BY r.generated_at DESC
		LIMIT 50`
	);

	const groups = result.rows.map((row) => ({
		reportId: row.report_id,
		generatedAt:
			row.generated_at instanceof Date ? row.generated_at.toISOString() : String(row.generated_at),
		topOpportunity: row.top_meaning,
		draftCount: Number(row.draft_count),
		platformCount: Number(row.platform_count)
	}));

	return NextResponse.json({ groups });
}
