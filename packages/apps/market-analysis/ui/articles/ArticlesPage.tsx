import { query } from '@pulsar/shared/db/postgres';
import Link from 'next/link';
import React from 'react';

/**
 * Articles list page. Server component. Fetches reports that have at least
 * one article in `content_articles`, grouped by report, sorted by
 * `generated_at` descending.
 *
 * The previous Drafts page (under /drafts) still resolves and renders
 * `content_drafts` rows for legacy reports. New runs write to
 * `content_articles` instead and surface here.
 */

export const dynamic = 'force-dynamic';

interface GroupRow {
	report_id: string;
	generated_at: Date;
	top_angle: string | null;
	article_count: string;
}

interface ArticleGroup {
	reportId: string;
	generatedAt: Date;
	topAngle: string | null;
	articleCount: number;
}

async function loadGroupedArticles(): Promise<ArticleGroup[]> {
	const result = await query<GroupRow>(
		`SELECT
			r.id AS report_id,
			r.generated_at,
			(SELECT angle FROM content_articles WHERE report_id = r.id ORDER BY created_at ASC LIMIT 1) AS top_angle,
			COUNT(a.id) AS article_count
		FROM reports r
		JOIN content_articles a ON a.report_id = r.id
		GROUP BY r.id, r.generated_at
		ORDER BY r.generated_at DESC
		LIMIT 50`
	);

	return result.rows.map((row) => ({
		reportId: row.report_id,
		generatedAt: row.generated_at instanceof Date ? row.generated_at : new Date(row.generated_at),
		topAngle: row.top_angle,
		articleCount: Number(row.article_count)
	}));
}

function formatDate(date: Date): string {
	return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default async function ArticlesPage() {
	const groups = await loadGroupedArticles();

	return (
		<div>
			<h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Articles</h1>
			<p className="mt-1 text-gray-500 dark:text-neutral-400">
				Four-file article packages grouped by the report they came from
			</p>

			<div className="mt-6 max-w-[37rem] space-y-4">
				{groups.length === 0 ? (
					<div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
						<p className="text-sm text-gray-700 dark:text-neutral-300">No articles yet.</p>
						<p className="mt-2 text-sm text-gray-500 dark:text-neutral-400">
							Trigger a content run via{' '}
							<code className="rounded bg-gray-100 dark:bg-neutral-800 px-1.5 py-0.5 text-xs font-mono">
								pnpm run pipeline -- --content-only --report-id=&lt;uuid&gt;
							</code>
							.
						</p>
						<p className="mt-2 text-sm text-gray-500 dark:text-neutral-400">
							Older draft-style outputs are still available at{' '}
							<Link href="/drafts" className="text-indigo-600 underline">
								/drafts
							</Link>
							.
						</p>
					</div>
				) : (
					groups.map((group) => (
						<Link
							key={group.reportId}
							href={`/articles/${group.reportId}`}
							className="block rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 transition hover:border-indigo-300 hover:shadow-sm"
						>
							<div className="flex items-start justify-between gap-4">
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-gray-900 dark:text-neutral-100">
										Lead angle
									</p>
									<p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-neutral-400">
										{group.topAngle ?? 'No articles persisted for this report yet.'}
									</p>
									<p className="mt-3 text-xs text-gray-500 dark:text-neutral-400">
										{group.articleCount} {group.articleCount === 1 ? 'article' : 'articles'}
									</p>
								</div>
								<span className="flex-shrink-0 text-xs text-gray-400 dark:text-neutral-500">
									{formatDate(group.generatedAt)}
								</span>
							</div>
						</Link>
					))
				)}
			</div>
		</div>
	);
}

export { loadGroupedArticles };
export type { ArticleGroup };
