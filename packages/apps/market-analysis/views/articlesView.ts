import { query } from '@pulsar/shared/db/postgres';
import {
	type Block,
	type ViewModel,
	emptyState,
	heading,
	list,
	markdown,
	section,
	tabs,
	view
} from '@pulsar/view-model';

export const ARTICLES_LIST_VIEW_ID = 'market-analysis.articles.list';
export const ARTICLES_VIEWER_VIEW_ID = 'market-analysis.articles.viewer';

const ARTICLES_APP_SLUG = 'market-analysis';

interface ArticleGroupRow {
	report_id: string;
	generated_at: Date;
	top_angle: string | null;
	article_count: string;
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

interface ReportRow {
	id: string;
	generated_at: Date;
}

export type ArticleGroup = {
	reportId: string;
	generatedAt: Date;
	topAngle: string | null;
	articleCount: number;
};

async function loadArticleGroups(): Promise<ArticleGroup[]> {
	const result = await query<ArticleGroupRow>(
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

export function buildArticlesListViewFromGroups(groups: ArticleGroup[]): ViewModel {
	if (groups.length === 0) {
		return view(
			ARTICLES_LIST_VIEW_ID,
			[
				emptyState(
					'No articles yet.',
					'Trigger a content run via pnpm run pipeline -- --content-only --report-id=<uuid>. Older draft-style outputs remain at /drafts.'
				)
			],
			{ title: 'Articles' }
		);
	}

	const items = groups.map((g) => ({
		primary: g.topAngle ?? 'No articles persisted for this report yet.',
		secondary: `${g.articleCount} ${g.articleCount === 1 ? 'article' : 'articles'}`,
		timestamp: formatDate(g.generatedAt),
		href: `/articles/${g.reportId}`
	}));

	return view(
		ARTICLES_LIST_VIEW_ID,
		[
			section(undefined, [list(items, 'plain')], {
				subtitle: 'Four-file article packages grouped by the report they came from'
			})
		],
		{ title: 'Articles' }
	);
}

export async function buildArticlesListView(): Promise<ViewModel> {
	const groups = await loadArticleGroups();
	return buildArticlesListViewFromGroups(groups);
}

// --- Article viewer ---

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

export type ArticleFileSet = {
	id: string;
	articleSlug: string;
	title: string | null;
	subtitle: string | null;
	angle: string;
	opportunitySignal: string;
	contentMd: string;
	quotesMd: string;
	imagesMd: string;
	publicationsMd: string;
};

export function buildArticlesViewerViewFromArticles(
	report: ReportRow,
	articles: ArticleFileSet[]
): ViewModel {
	const generatedAt =
		report.generated_at instanceof Date ? report.generated_at : new Date(report.generated_at);

	if (articles.length === 0) {
		return view(ARTICLES_VIEWER_VIEW_ID, [emptyState('No articles for this report.')], {
			title: 'Articles for report',
			meta: { reportId: report.id, generatedAt: generatedAt.toISOString() }
		});
	}

	const articleTabs = articles.map((a) => ({
		id: a.id,
		label: a.title?.trim() || a.articleSlug,
		blocks: buildArticlePane(a)
	}));

	return view(
		ARTICLES_VIEWER_VIEW_ID,
		[
			section(undefined, [tabs(articleTabs, articleTabs[0]?.id)], {
				subtitle: generatedAt.toLocaleString()
			})
		],
		{
			title: 'Articles for report',
			meta: { reportId: report.id, generatedAt: generatedAt.toISOString() }
		}
	);
}

function buildArticlePane(a: ArticleFileSet): Block[] {
	const headerBlocks: Block[] = [];
	if (a.subtitle) headerBlocks.push(heading(3, a.subtitle));
	headerBlocks.push(
		list(
			[
				{ primary: 'Angle', secondary: a.angle },
				{ primary: 'Opportunity', secondary: a.opportunitySignal }
			],
			'plain'
		)
	);

	const contentTabs = tabs(
		[
			{ id: 'content', label: 'Content', blocks: [markdown(a.contentMd)] },
			{ id: 'quotes', label: 'Quotes', blocks: [markdown(a.quotesMd)] },
			{ id: 'images', label: 'Images', blocks: [markdown(a.imagesMd)] },
			{ id: 'publications', label: 'Publications', blocks: [markdown(a.publicationsMd)] }
		],
		'content'
	);

	return [...headerBlocks, contentTabs];
}

export async function buildArticlesViewerView(reportId: string): Promise<ViewModel | null> {
	const report = await loadReport(reportId);
	if (!report) return null;

	const [rawArticles, seriesState] = await Promise.all([
		loadArticles(reportId),
		loadSeriesStateForHeader()
	]);

	const articles: ArticleFileSet[] = rawArticles.map((row) => {
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
			contentMd: row.content_md,
			quotesMd: row.quotes_md,
			imagesMd,
			publicationsMd
		};
	});

	return buildArticlesViewerViewFromArticles(report, articles);
}
