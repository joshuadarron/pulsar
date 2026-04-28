import Link from 'next/link';
import { query } from '@pulsar/shared/db/postgres';
import DashboardWidgets from '@/components/DashboardWidgets';
import type { ReportData } from '@pulsar/shared/types';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
	const [
		articlesRes,
		reportsRes,
		pendingDraftsRes,
		latestReportRes,
		sourceDistRes,
		sentimentDistRes,
		draftStatusRes,
		recentArticlesRes,
		runsRes,
		successRateRes
	] = await Promise.all([
		query<{ count: string }>('SELECT count(*) FROM articles'),
		query<{ count: string }>('SELECT count(*) FROM reports'),
		query<{ count: string }>("SELECT count(*) FROM content_drafts WHERE status = 'draft'"),
		query<{ id: string; generated_at: string; report_data: ReportData }>(
			'SELECT id, generated_at, report_data FROM reports ORDER BY generated_at DESC LIMIT 1'
		),
		query<{ source_platform: string; count: string }>(
			'SELECT source_platform, count(*)::text as count FROM articles GROUP BY source_platform ORDER BY count(*) DESC'
		),
		query<{ sentiment: string; count: string }>(
			"SELECT COALESCE(sentiment, 'neutral') as sentiment, count(*)::text as count FROM articles GROUP BY COALESCE(sentiment, 'neutral') ORDER BY count(*) DESC"
		),
		query<{ status: string; count: string }>(
			'SELECT status, count(*)::text as count FROM content_drafts GROUP BY status ORDER BY count(*) DESC'
		),
		query<{
			id: string;
			title: string;
			source_platform: string;
			sentiment: string;
			published_at: string;
			score: number;
		}>(
			"SELECT id, title, source_platform, COALESCE(sentiment, 'neutral') as sentiment, published_at, COALESCE(score, 0) as score FROM articles ORDER BY published_at DESC LIMIT 6"
		),
		query<{
			id: string;
			started_at: string;
			completed_at: string | null;
			status: string;
			trigger: string;
			run_type: string;
			articles_new: number;
			articles_scraped: number;
		}>(
			'SELECT id, started_at, completed_at, status, trigger, run_type, COALESCE(articles_new, 0) as articles_new, COALESCE(articles_scraped, 0) as articles_scraped FROM runs ORDER BY started_at DESC LIMIT 5'
		),
		query<{ success: string; total: string }>(
			"SELECT count(*) FILTER (WHERE status = 'complete')::text as success, count(*)::text as total FROM runs"
		)
	]);

	const totalArticles = Number.parseInt(articlesRes.rows[0]?.count || '0');
	const totalReports = Number.parseInt(reportsRes.rows[0]?.count || '0');
	const pendingDrafts = Number.parseInt(pendingDraftsRes.rows[0]?.count || '0');
	const latestReport = latestReportRes.rows[0] || null;
	const sourceDist = sourceDistRes.rows.map((r) => ({ ...r, count: Number.parseInt(r.count) }));
	const sentimentDist = sentimentDistRes.rows.map((r) => ({
		...r,
		count: Number.parseInt(r.count)
	}));
	const draftStatus = draftStatusRes.rows.map((r) => ({ ...r, count: Number.parseInt(r.count) }));
	const recentArticles = recentArticlesRes.rows;
	const recentRuns = runsRes.rows;
	const totalRuns = Number.parseInt(successRateRes.rows[0]?.total || '0');
	const successRuns = Number.parseInt(successRateRes.rows[0]?.success || '0');
	const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 0;

	return (
		<div>
			<h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Dashboard</h1>
			<p className="mt-1 text-gray-500 dark:text-neutral-400">
				Overview of your market intelligence pipeline
			</p>

			{/* Stat Cards */}
			<div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
				<StatCard
					label="Total Articles"
					value={totalArticles}
					href="/feed"
					icon="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
					accent="indigo"
				/>
				<StatCard
					label="Reports"
					value={totalReports}
					href="/reports"
					icon="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
					accent="violet"
				/>
				<StatCard
					label="Pending Drafts"
					value={pendingDrafts}
					href="/drafts"
					icon="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
					accent="amber"
				/>
				<StatCard
					label="Success Rate"
					value={successRate}
					suffix="%"
					href="/runs"
					icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
					accent={successRate >= 80 ? 'green' : successRate >= 50 ? 'amber' : 'red'}
					isRate
				/>
			</div>

			<DashboardWidgets
				latestReport={latestReport}
				sourceDist={sourceDist}
				sentimentDist={sentimentDist}
				draftStatus={draftStatus}
				recentArticles={recentArticles}
				recentRuns={recentRuns}
				successRate={successRate}
			/>
		</div>
	);
}

const ACCENT = {
	indigo: {
		bg: 'bg-indigo-50 dark:bg-indigo-950',
		icon: 'text-indigo-600 dark:text-indigo-400',
		ring: 'ring-indigo-500/20 dark:ring-indigo-400/20',
		value: 'text-gray-900 dark:text-neutral-100'
	},
	violet: {
		bg: 'bg-violet-50 dark:bg-violet-950',
		icon: 'text-violet-600 dark:text-violet-400',
		ring: 'ring-violet-500/20 dark:ring-violet-400/20',
		value: 'text-gray-900 dark:text-neutral-100'
	},
	amber: {
		bg: 'bg-amber-50 dark:bg-amber-950',
		icon: 'text-amber-600 dark:text-amber-400',
		ring: 'ring-amber-500/20 dark:ring-amber-400/20',
		value: 'text-gray-900 dark:text-neutral-100'
	},
	green: {
		bg: 'bg-green-50 dark:bg-green-950',
		icon: 'text-green-600 dark:text-green-400',
		ring: 'ring-green-500/20 dark:ring-green-400/20',
		value: 'text-green-600 dark:text-green-400'
	},
	red: {
		bg: 'bg-red-50 dark:bg-red-950',
		icon: 'text-red-600 dark:text-red-400',
		ring: 'ring-red-500/20 dark:ring-red-400/20',
		value: 'text-red-600 dark:text-red-400'
	}
} as const;

function StatCard({
	label,
	value,
	href,
	suffix,
	icon,
	accent,
	isRate
}: {
	label: string;
	value: number;
	href: string;
	suffix?: string;
	icon: string;
	accent: keyof typeof ACCENT;
	isRate?: boolean;
}) {
	const a = ACCENT[accent];

	return (
		<Link
			href={href}
			className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 transition hover:border-gray-300 dark:hover:border-neutral-600 hover:shadow-sm"
		>
			<div className="flex items-center gap-3">
				<div
					className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${a.bg} ring-1 ${a.ring}`}
				>
					<svg
						className={`h-5 w-5 ${a.icon}`}
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={1.5}
					>
						<path strokeLinecap="round" strokeLinejoin="round" d={icon} />
					</svg>
				</div>
				<p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-neutral-500">
					{label}
				</p>
			</div>
			<div>
				<div className="mt-3 flex items-baseline gap-1">
					<span
						className={`text-3xl font-bold tabular-nums ${isRate ? a.value : 'text-gray-900 dark:text-neutral-100'}`}
					>
						{value.toLocaleString()}
					</span>
					{suffix && (
						<span
							className={`text-lg font-semibold ${isRate ? a.value : 'text-gray-400 dark:text-neutral-500'}`}
						>
							{suffix}
						</span>
					)}
				</div>
				{isRate && (
					<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800">
						<div
							className={`h-full rounded-full transition-all ${accent === 'green' ? 'bg-green-500' : accent === 'amber' ? 'bg-amber-500' : 'bg-red-500'}`}
							style={{ width: `${value}%` }}
						/>
					</div>
				)}
			</div>
		</Link>
	);
}
