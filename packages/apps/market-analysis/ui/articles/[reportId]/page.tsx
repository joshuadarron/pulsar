import Link from 'next/link';
import { notFound } from 'next/navigation';
import React from 'react';

import { query } from '@pulsar/shared/db/postgres';

import { renderMarkdown } from '../markdown.js';
import ArticleViewer, { type ArticleFileSet } from './ArticleViewer';

export const dynamic = 'force-dynamic';

interface ReportRow {
	id: string;
	generated_at: Date;
}

interface ArticleRow {
	id: string;
	article_slug: string;
	title: string | null;
	subtitle: string | null;
	angle: string;
	opportunity_signal: string;
	metaphor_family: string | null;
	primary_medium_pub: string | null;
	content_md: string;
	quotes_md: string;
	images_md: string;
	publications_md: string;
	created_at: Date;
}

interface SeriesStateRow {
	recent_metaphor_families: unknown;
	medium_publication_queue: unknown;
}

const ARTICLES_APP_SLUG = 'market-analysis';

async function loadReport(reportId: string): Promise<ReportRow | null> {
	const result = await query<ReportRow>('SELECT id, generated_at FROM reports WHERE id = $1', [
		reportId
	]);
	return result.rows[0] ?? null;
}

async function loadArticles(reportId: string): Promise<ArticleRow[]> {
	const result = await query<ArticleRow>(
		`SELECT id, article_slug, title, subtitle, angle, opportunity_signal,
		        metaphor_family, primary_medium_pub, content_md, quotes_md,
		        images_md, publications_md, created_at
		 FROM content_articles WHERE report_id = $1 ORDER BY created_at ASC`,
		[reportId]
	);
	return result.rows;
}

async function loadSeriesStateForHeader(): Promise<{
	recent: string[];
	queue: Record<string, string>;
}> {
	const result = await query<SeriesStateRow>(
		'SELECT recent_metaphor_families, medium_publication_queue FROM content_series_state WHERE app_slug = $1',
		[ARTICLES_APP_SLUG]
	);
	if (result.rows.length === 0) return { recent: [], queue: {} };
	const row = result.rows[0];
	const recent = Array.isArray(row.recent_metaphor_families)
		? (row.recent_metaphor_families as string[]).filter((entry) => typeof entry === 'string')
		: [];
	const queue =
		row.medium_publication_queue && typeof row.medium_publication_queue === 'object'
			? (row.medium_publication_queue as Record<string, string>)
			: {};
	return { recent, queue };
}

function buildImagesHeader(metaphor: string | null, recent: string[]): string {
	const lines: string[] = ['## Series state at generation'];
	if (metaphor) lines.push(`- Metaphor family assigned: \`${metaphor}\``);
	if (recent.length > 0) {
		const others = recent.filter((entry) => entry !== metaphor);
		if (others.length > 0) {
			lines.push(
				`- Recently used (excluded for next pick): ${others.map((f) => `\`${f}\``).join(', ')}`
			);
		}
	}
	return `${lines.join('\n')}\n\n`;
}

function buildPublicationsHeader(
	primaryMediumPub: string | null,
	queue: Record<string, string>
): string {
	const lines: string[] = ['## Series state at generation'];
	if (primaryMediumPub) lines.push(`- Primary Medium publication assigned: ${primaryMediumPub}`);
	const queueEntries = Object.entries(queue);
	if (queueEntries.length > 0) {
		lines.push('- Medium publication queue:');
		for (const [pub, when] of queueEntries) {
			lines.push(`  - ${pub}: last assigned ${when}`);
		}
	}
	return `${lines.join('\n')}\n\n`;
}

export default async function ArticleViewerPage({
	params
}: {
	params: Promise<{ reportId: string }>;
}) {
	const { reportId } = await params;
	const report = await loadReport(reportId);
	if (!report) notFound();

	const [articles, seriesState] = await Promise.all([
		loadArticles(reportId),
		loadSeriesStateForHeader()
	]);

	const fileSets: ArticleFileSet[] = articles.map((row) => {
		const imagesMd = buildImagesHeader(row.metaphor_family, seriesState.recent) + row.images_md;
		const publicationsMd =
			buildPublicationsHeader(row.primary_medium_pub, seriesState.queue) + row.publications_md;
		return {
			id: row.id,
			articleSlug: row.article_slug,
			title: row.title,
			subtitle: row.subtitle,
			angle: row.angle,
			opportunitySignal: row.opportunity_signal,
			metaphorFamily: row.metaphor_family,
			primaryMediumPub: row.primary_medium_pub,
			contentMd: row.content_md,
			quotesMd: row.quotes_md,
			imagesMd,
			publicationsMd,
			contentHtml: renderMarkdown(row.content_md),
			quotesHtml: renderMarkdown(row.quotes_md),
			imagesHtml: renderMarkdown(imagesMd),
			publicationsHtml: renderMarkdown(publicationsMd)
		};
	});

	const generatedAt =
		report.generated_at instanceof Date ? report.generated_at : new Date(report.generated_at);

	return (
		<div>
			<Link href="/articles" className="text-sm text-indigo-600 hover:text-indigo-700">
				Back to articles
			</Link>
			<h1 className="mt-3 text-2xl font-bold text-gray-900 dark:text-neutral-100">
				Articles for report
			</h1>
			<p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
				{generatedAt.toLocaleString()}
			</p>

			<div className="mt-8">
				<ArticleViewer articles={fileSets} />
			</div>
		</div>
	);
}
