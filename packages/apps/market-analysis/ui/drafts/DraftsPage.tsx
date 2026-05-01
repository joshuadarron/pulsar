import { query } from '@pulsar/shared/db/postgres';
import Link from 'next/link';
import React from 'react';

/**
 * Drafts list page (Phase 6). Server component. Fetches reports that have at
 * least one draft, grouped by report, sorted by `generated_at` descending.
 *
 * Decision: this server component queries postgres directly via
 * `@pulsar/shared/db/postgres` rather than calling the
 * `/api/drafts/grouped` route over HTTP. Server components share the same
 * process and pool, so an internal fetch would just add latency. The HTTP
 * endpoint stays available for any future client consumer.
 */

interface GroupRow {
	report_id: string;
	generated_at: Date;
	top_meaning: string | null;
	draft_count: string;
	platform_count: string;
}

interface DraftGroup {
	reportId: string;
	generatedAt: Date;
	topOpportunity: string | null;
	draftCount: number;
	platformCount: number;
}

async function loadGroupedDrafts(): Promise<DraftGroup[]> {
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

export default async function DraftsPage() {
	const groups = await loadGroupedDrafts();

	return (
		<div>
			<h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Content Drafts</h1>
			<p className="mt-1 text-gray-500 dark:text-neutral-400">
				AI-generated content grouped by the report it came from
			</p>

			<div className="mt-6 max-w-3xl space-y-4">
				{groups.length === 0 ? (
					<div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
						<p className="text-sm text-gray-700 dark:text-neutral-300">No drafts yet.</p>
						<p className="mt-2 text-sm text-gray-500 dark:text-neutral-400">
							Trigger a content run via{' '}
							<code className="rounded bg-gray-100 dark:bg-neutral-800 px-1.5 py-0.5 text-xs font-mono">
								pnpm run pipeline -- --content-only --report-id=&lt;uuid&gt;
							</code>
							.
						</p>
					</div>
				) : (
					groups.map((group) => (
						<article
							key={group.reportId}
							className="relative rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 transition hover:shadow-sm"
						>
							<div className="flex items-start justify-between gap-4">
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-gray-900 dark:text-neutral-100">
										Top opportunity
									</p>
									<p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-neutral-400">
										{group.topOpportunity ?? 'No interpretations available for this report.'}
									</p>
									<p className="mt-3 text-xs text-gray-500 dark:text-neutral-400">
										{group.draftCount} {group.draftCount === 1 ? 'draft' : 'drafts'} across{' '}
										{group.platformCount} {group.platformCount === 1 ? 'platform' : 'platforms'}
									</p>
								</div>
								<div className="flex flex-col items-end gap-3">
									<span className="text-xs text-gray-400 dark:text-neutral-500">
										{formatDate(group.generatedAt)}
									</span>
									<Link
										href={`/drafts/${group.reportId}`}
										className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
									>
										View drafts
									</Link>
								</div>
							</div>
						</article>
					))
				)}
			</div>
		</div>
	);
}

export { loadGroupedDrafts };
export type { DraftGroup };
