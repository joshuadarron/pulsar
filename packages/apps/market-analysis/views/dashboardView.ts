import { query } from '@pulsar/shared/db/postgres';
import type { ReportData } from '@pulsar/shared/types';
import {
	type Block,
	type ChartBlock,
	type ListItem,
	type TableRow,
	type Tone,
	type ViewModel,
	card,
	chart,
	emptyState,
	kpiGrid,
	list,
	markdown,
	section,
	table,
	view
} from '@pulsar/view-model';

export const DASHBOARD_VIEW_ID = 'market-analysis.dashboard';

interface SourceRow {
	source_platform: string;
	count: string;
}
interface SentimentRow {
	sentiment: string;
	count: string;
}
interface ArticleRow {
	id: string;
	title: string;
	source_platform: string;
	sentiment: string;
	published_at: Date | string | null;
	score: number;
}
interface RunRow {
	id: string;
	started_at: Date | string;
	completed_at: Date | string | null;
	status: string;
	trigger: string;
	run_type: string;
	articles_new: number;
	articles_scraped: number;
}
interface LatestReportRow {
	id: string;
	generated_at: Date | string;
	report_data: ReportData;
}

const STATUS_TONE: Record<string, Tone> = {
	complete: 'positive',
	failed: 'negative',
	cancelled: 'warn',
	running: 'info'
};

const RUN_TYPE_TONE: Record<string, Tone> = {
	scrape: 'info',
	pipeline: 'info'
};

const SENTIMENT_TONE: Record<string, Tone> = {
	positive: 'positive',
	negative: 'negative',
	neutral: 'neutral'
};

export async function buildDashboardView(): Promise<ViewModel> {
	const [
		articlesRes,
		reportsRes,
		pendingDraftsRes,
		latestReportRes,
		sourceDistRes,
		sentimentDistRes,
		recentArticlesRes,
		runsRes,
		successRateRes
	] = await Promise.all([
		query<{ count: string }>('SELECT count(*) FROM articles'),
		query<{ count: string }>('SELECT count(*) FROM reports'),
		query<{ count: string }>("SELECT count(*) FROM content_drafts WHERE status = 'draft'"),
		query<LatestReportRow>(
			'SELECT id, generated_at, report_data FROM reports ORDER BY generated_at DESC LIMIT 1'
		),
		query<SourceRow>(
			'SELECT source_platform, count(*)::text as count FROM articles GROUP BY source_platform ORDER BY count(*) DESC'
		),
		query<SentimentRow>(
			"SELECT COALESCE(sentiment, 'neutral') as sentiment, count(*)::text as count FROM articles GROUP BY COALESCE(sentiment, 'neutral') ORDER BY count(*) DESC"
		),
		query<ArticleRow>(
			"SELECT id, title, source_platform, COALESCE(sentiment, 'neutral') as sentiment, published_at, COALESCE(score, 0) as score FROM articles ORDER BY published_at DESC LIMIT 6"
		),
		query<RunRow>(
			'SELECT id, started_at, completed_at, status, trigger, run_type, COALESCE(articles_new, 0) as articles_new, COALESCE(articles_scraped, 0) as articles_scraped FROM runs ORDER BY started_at DESC LIMIT 5'
		),
		query<{ success: string; total: string }>(
			"SELECT count(*) FILTER (WHERE status = 'complete')::text as success, count(*)::text as total FROM runs"
		)
	]);

	const totalArticles = Number.parseInt(articlesRes.rows[0]?.count ?? '0', 10);
	const totalReports = Number.parseInt(reportsRes.rows[0]?.count ?? '0', 10);
	const pendingDrafts = Number.parseInt(pendingDraftsRes.rows[0]?.count ?? '0', 10);
	const totalRuns = Number.parseInt(successRateRes.rows[0]?.total ?? '0', 10);
	const successRuns = Number.parseInt(successRateRes.rows[0]?.success ?? '0', 10);
	const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 0;

	const sourceDist = sourceDistRes.rows.map((r) => ({
		platform: r.source_platform,
		count: Number.parseInt(r.count, 10)
	}));
	const sentimentDist = sentimentDistRes.rows.map((r) => ({
		sentiment: r.sentiment,
		count: Number.parseInt(r.count, 10)
	}));
	const latestReport = latestReportRes.rows[0] ?? null;

	const blocks: Block[] = [];

	blocks.push(
		kpiGrid(
			[
				card('Total Articles', totalArticles.toLocaleString(), {
					href: '/feed',
					tone: 'info'
				}),
				card('Reports', totalReports.toLocaleString(), {
					href: '/reports',
					tone: 'info'
				}),
				card('Pending Drafts', pendingDrafts.toLocaleString(), {
					href: '/drafts',
					tone: 'warn'
				}),
				card('Success Rate', `${successRate}%`, {
					href: '/runs',
					tone: successRate >= 80 ? 'positive' : successRate >= 50 ? 'warn' : 'negative'
				})
			],
			4
		)
	);

	blocks.push(section('Recent Runs', [runsTable(runsRes.rows)], { id: 'recent-runs' }));

	if (latestReport) {
		blocks.push(latestReportSection(latestReport));
	}

	const charts: Block[] = [];
	if (sourceDist.length > 0) charts.push(sourcePie(sourceDist));
	if (sentimentDist.length > 0) charts.push(sentimentPie(sentimentDist));
	if (charts.length > 0) {
		blocks.push(section('Distribution', charts, { id: 'distribution' }));
	}

	if (recentArticlesRes.rows.length > 0) {
		blocks.push(
			section('Recent Articles', [recentArticlesList(recentArticlesRes.rows)], {
				id: 'recent-articles'
			})
		);
	}

	return view(DASHBOARD_VIEW_ID, blocks, {
		title: 'Dashboard',
		meta: { totalArticles, totalReports, pendingDrafts, successRate }
	});
}

function runsTable(rows: RunRow[]): Block {
	if (rows.length === 0) {
		return emptyState('No runs yet.', 'Trigger a scrape or pipeline from /runs.');
	}
	const tableRows: TableRow[] = rows.map((r) => ({
		id: r.id,
		href: `/runs/${r.id}`,
		cells: {
			type: { kind: 'badge', label: r.run_type, tone: RUN_TYPE_TONE[r.run_type] ?? 'neutral' },
			trigger: { kind: 'text', value: r.trigger },
			started: { kind: 'date', iso: toIso(r.started_at), format: 'datetime' },
			status: { kind: 'badge', label: r.status, tone: STATUS_TONE[r.status] ?? 'neutral' },
			scraped: { kind: 'number', value: r.articles_scraped, format: 'integer' },
			added: { kind: 'number', value: r.articles_new, format: 'integer' }
		}
	}));
	return table(
		[
			{ key: 'type', label: 'Type' },
			{ key: 'trigger', label: 'Trigger' },
			{ key: 'started', label: 'Started' },
			{ key: 'status', label: 'Status' },
			{ key: 'scraped', label: 'Scraped', align: 'right' },
			{ key: 'added', label: 'New', align: 'right' }
		],
		tableRows
	);
}

function latestReportSection(latest: LatestReportRow): Block {
	const exec = latest.report_data?.sections?.executiveSummary?.text ?? '';
	const interp = latest.report_data?.sections?.signalInterpretation;
	const chips: string[] = interp?.narrative?.length
		? interp.narrative.slice(0, 3).map((p) => {
				const end = p.search(/[.!?](\s|$)/);
				return end > 0 ? p.slice(0, end + 1) : p;
			})
		: (interp?.interpretations ?? []).slice(0, 3).map((i) => i.signal);

	const inner: Block[] = [];
	if (exec) inner.push(markdown(exec));
	if (chips.length > 0) {
		inner.push(
			list(
				chips.map((c) => ({ primary: c })),
				'plain'
			)
		);
	}
	const subtitle = `${new Date(latest.generated_at).toLocaleDateString()} · ${
		latest.report_data?.reportMetadata?.articleCount ?? 0
	} articles analyzed`;
	return section('Latest Report', inner, { id: 'latest-report', subtitle });
}

function sourcePie(sources: { platform: string; count: number }[]): ChartBlock {
	const total = sources.reduce((sum, s) => sum + s.count, 0);
	return chart(
		'pie',
		[
			{
				name: 'sources',
				points: sources.map((s) => ({
					x: s.platform,
					y: s.count,
					label: total > 0 ? `${Math.round((s.count / total) * 100)}%` : '0%'
				}))
			}
		],
		{ title: 'Source platform', height: 280 }
	);
}

function sentimentPie(sentiments: { sentiment: string; count: number }[]): ChartBlock {
	const total = sentiments.reduce((sum, s) => sum + s.count, 0);
	return chart(
		'pie',
		[
			{
				name: 'sentiments',
				points: sentiments.map((s) => ({
					x: s.sentiment,
					y: s.count,
					label: total > 0 ? `${Math.round((s.count / total) * 100)}%` : '0%'
				}))
			}
		],
		{ title: 'Article sentiment', height: 280 }
	);
}

function recentArticlesList(rows: ArticleRow[]): Block {
	const items: ListItem[] = rows.map((r) => {
		const ts = r.published_at ? new Date(r.published_at).toLocaleDateString() : undefined;
		const tone = SENTIMENT_TONE[r.sentiment] ?? 'neutral';
		return {
			primary: r.title,
			secondary: `${r.source_platform} · score ${r.score}`,
			timestamp: ts,
			badge: { label: r.sentiment, tone }
		};
	});
	return list(items, 'plain');
}

function toIso(value: Date | string): string {
	if (value instanceof Date) return value.toISOString();
	return new Date(value).toISOString();
}
