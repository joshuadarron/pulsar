import Link from "next/link";
import { query } from "@/lib/db/postgres";
import DashboardWidgets from "@/components/DashboardWidgets";
import type { ReportData } from "@/types";

export const dynamic = "force-dynamic";

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
    successRateRes,
  ] = await Promise.all([
    query<{ count: string }>("SELECT count(*) FROM articles"),
    query<{ count: string }>("SELECT count(*) FROM reports"),
    query<{ count: string }>("SELECT count(*) FROM content_drafts WHERE status = 'draft'"),
    query<{ id: string; generated_at: string; report_data: ReportData }>(
      "SELECT id, generated_at, report_data FROM reports ORDER BY generated_at DESC LIMIT 1",
    ),
    query<{ source_platform: string; count: string }>(
      "SELECT source_platform, count(*)::text as count FROM articles GROUP BY source_platform ORDER BY count(*) DESC",
    ),
    query<{ sentiment: string; count: string }>(
      "SELECT COALESCE(sentiment, 'neutral') as sentiment, count(*)::text as count FROM articles GROUP BY sentiment ORDER BY count(*) DESC",
    ),
    query<{ status: string; count: string }>(
      "SELECT status, count(*)::text as count FROM content_drafts GROUP BY status ORDER BY count(*) DESC",
    ),
    query<{ id: string; title: string; source_platform: string; sentiment: string; published_at: string; score: number }>(
      "SELECT id, title, source_platform, COALESCE(sentiment, 'neutral') as sentiment, published_at, COALESCE(score, 0) as score FROM articles ORDER BY published_at DESC LIMIT 6",
    ),
    query<{ id: string; started_at: string; status: string; run_type: string; articles_new: number; articles_scraped: number }>(
      "SELECT id, started_at, status, run_type, COALESCE(articles_new, 0) as articles_new, COALESCE(articles_scraped, 0) as articles_scraped FROM runs ORDER BY started_at DESC LIMIT 5",
    ),
    query<{ success: string; total: string }>(
      "SELECT count(*) FILTER (WHERE status = 'complete')::text as success, count(*)::text as total FROM runs",
    ),
  ]);

  const totalArticles = parseInt(articlesRes.rows[0]?.count || "0");
  const totalReports = parseInt(reportsRes.rows[0]?.count || "0");
  const pendingDrafts = parseInt(pendingDraftsRes.rows[0]?.count || "0");
  const latestReport = latestReportRes.rows[0] || null;
  const sourceDist = sourceDistRes.rows.map((r) => ({ ...r, count: parseInt(r.count) }));
  const sentimentDist = sentimentDistRes.rows.map((r) => ({ ...r, count: parseInt(r.count) }));
  const draftStatus = draftStatusRes.rows.map((r) => ({ ...r, count: parseInt(r.count) }));
  const recentArticles = recentArticlesRes.rows;
  const recentRuns = runsRes.rows;
  const totalRuns = parseInt(successRateRes.rows[0]?.total || "0");
  const successRuns = parseInt(successRateRes.rows[0]?.success || "0");
  const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Dashboard</h1>
      <p className="mt-1 text-gray-500 dark:text-neutral-400">Overview of your DevRel intelligence pipeline</p>

      {/* Stat Cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Articles" value={totalArticles} href="/feed" />
        <StatCard label="Reports" value={totalReports} href="/reports" />
        <StatCard label="Pending Drafts" value={pendingDrafts} href="/drafts" />
        <StatCard label="Success Rate" value={successRate} suffix="%" href="/runs" color={successRate >= 80 ? "green" : successRate >= 50 ? "yellow" : "red"} />
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

function StatCard({
  label,
  value,
  href,
  suffix,
  color,
}: {
  label: string;
  value: number;
  href: string;
  suffix?: string;
  color?: "green" | "yellow" | "red";
}) {
  const valueColor = color
    ? color === "green" ? "text-green-600 dark:text-green-400"
      : color === "yellow" ? "text-yellow-600 dark:text-yellow-400"
      : "text-red-600 dark:text-red-400"
    : "text-gray-900 dark:text-neutral-100";

  return (
    <Link href={href} className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 transition hover:border-gray-300 dark:hover:border-neutral-600">
      <p className="text-sm font-medium text-gray-500 dark:text-neutral-400">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${valueColor}`}>
        {value.toLocaleString()}{suffix}
      </p>
    </Link>
  );
}
