import { query } from '@pulsar/shared/db/postgres';
import { type ViewModel, emptyState, list, section, view } from '@pulsar/view-model';

export const DRAFTS_LIST_VIEW_ID = 'market-analysis.drafts.list';

interface GroupRow {
	report_id: string;
	generated_at: Date;
	top_meaning: string | null;
	draft_count: string;
	platform_count: string;
}

export type DraftGroup = {
	reportId: string;
	generatedAt: Date;
	topOpportunity: string | null;
	draftCount: number;
	platformCount: number;
};

async function loadDraftGroups(): Promise<DraftGroup[]> {
	const result = await query<GroupRow>(
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

	return result.rows.map((row) => ({
		reportId: row.report_id,
		generatedAt: row.generated_at instanceof Date ? row.generated_at : new Date(row.generated_at),
		topOpportunity: row.top_meaning,
		draftCount: Number(row.draft_count),
		platformCount: Number(row.platform_count)
	}));
}

function formatDate(date: Date): string {
	return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function buildDraftsListViewFromGroups(groups: DraftGroup[]): ViewModel {
	if (groups.length === 0) {
		return view(
			DRAFTS_LIST_VIEW_ID,
			[
				emptyState(
					'No drafts yet.',
					'Trigger a content run via pnpm run pipeline -- --content-only --report-id=<uuid>.'
				)
			],
			{ title: 'Content Drafts' }
		);
	}

	const items = groups.map((g) => ({
		primary: g.topOpportunity ?? 'No interpretations available for this report.',
		secondary: `${g.draftCount} ${g.draftCount === 1 ? 'draft' : 'drafts'} across ${g.platformCount} ${g.platformCount === 1 ? 'platform' : 'platforms'}`,
		timestamp: formatDate(g.generatedAt),
		href: `/drafts/${g.reportId}`
	}));

	return view(
		DRAFTS_LIST_VIEW_ID,
		[
			section(undefined, [list(items, 'plain')], {
				subtitle: 'AI-generated content grouped by the report it came from'
			})
		],
		{ title: 'Content Drafts' }
	);
}

export async function buildDraftsListView(): Promise<ViewModel> {
	const groups = await loadDraftGroups();
	return buildDraftsListViewFromGroups(groups);
}
