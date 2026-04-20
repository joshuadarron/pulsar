"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { ReportData } from "@/types";

interface DashboardWidgetsProps {
  latestReport: { id: string; generated_at: string; report_data: ReportData } | null;
  sourceDist: { source_platform: string; count: number }[];
  sentimentDist: { sentiment: string; count: number }[];
  draftStatus: { status: string; count: number }[];
  recentArticles: { id: string; title: string; source_platform: string; sentiment: string; published_at: string; score: number }[];
  recentRuns: { id: string; started_at: string; completed_at: string | null; status: string; trigger: string; run_type: string; articles_new: number; articles_scraped: number }[];
  successRate: number;
}

const SOURCE_COLORS: Record<string, string> = {
  hackernews: "#ff6b00",
  reddit: "#ff4500",
  github: "#a855f7",
  arxiv: "#ef4444",
  hashnode: "#3b82f6",
  devto: "#06b6d4",
  medium: "#22c55e",
  rss: "#f59e0b",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "#10b981",
  neutral: "#6b7280",
  negative: "#ef4444",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "#f59e0b",
  approved: "#10b981",
  exported: "#6366f1",
};

export default function DashboardWidgets({
  latestReport,
  sourceDist,
  sentimentDist,
  draftStatus,
  recentArticles,
  recentRuns,
  successRate,
}: DashboardWidgetsProps) {
  const topKeywords = latestReport?.report_data?.trendingKeywords?.slice(0, 5) || [];
  const topTopics = latestReport?.report_data?.trendingTopics?.slice(0, 5) || [];

  return (
    <>
      {/* Recent Runs */}
      <div className="mt-6 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase text-gray-500 dark:text-neutral-400">Recent Runs</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-500 dark:text-neutral-400">Success rate:</span>
              <span className={`font-semibold ${successRate >= 80 ? "text-green-600 dark:text-green-400" : successRate >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}>
                {successRate}%
              </span>
            </div>
            <Link href="/runs" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
              All Runs
            </Link>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-neutral-800">
                <th className="pb-2 text-left text-xs font-medium text-gray-400 dark:text-neutral-500">Type</th>
                <th className="pb-2 text-left text-xs font-medium text-gray-400 dark:text-neutral-500">Trigger</th>
                <th className="pb-2 text-left text-xs font-medium text-gray-400 dark:text-neutral-500">Started</th>
                <th className="pb-2 text-left text-xs font-medium text-gray-400 dark:text-neutral-500">Duration</th>
                <th className="pb-2 text-left text-xs font-medium text-gray-400 dark:text-neutral-500">Status</th>
                <th className="pb-2 text-right text-xs font-medium text-gray-400 dark:text-neutral-500">Scraped</th>
                <th className="pb-2 text-right text-xs font-medium text-gray-400 dark:text-neutral-500">New</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-gray-400 dark:text-neutral-500">No runs yet.</td>
                </tr>
              ) : (
                recentRuns.map((run) => (
                  <tr key={run.id} className="border-b border-gray-50 dark:border-neutral-800 last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-neutral-800" onClick={() => window.location.href = `/runs/${run.id}`}>
                    <td className="py-2 text-sm">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        run.run_type === "scrape" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                      }`}>{run.run_type}</span>
                    </td>
                    <td className="py-2 text-sm text-gray-600 dark:text-neutral-400 capitalize">{run.trigger}</td>
                    <td className="py-2 text-sm text-gray-600 dark:text-neutral-400">{new Date(run.started_at).toLocaleString()}</td>
                    <td className="py-2 text-sm text-gray-600 dark:text-neutral-400">
                      <LiveDuration startedAt={run.started_at} completedAt={run.completed_at} status={run.status} />
                    </td>
                    <td className="py-2 text-sm">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        run.status === "complete" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                        run.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                        run.status === "cancelled" ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" :
                        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                      }`}>
                        {run.status === "running" && <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />}
                        {run.status}
                      </span>
                    </td>
                    <td className="py-2 text-right text-sm text-gray-600 dark:text-neutral-400">{run.articles_scraped}</td>
                    <td className="py-2 text-right text-sm text-gray-600 dark:text-neutral-400">{run.articles_new}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Latest Report + Trending Keywords */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Latest Report */}
        <div className="lg:col-span-2 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase text-gray-500 dark:text-neutral-400">Latest Report</h2>
            {latestReport && (
              <Link href={`/reports/${latestReport.id}`} className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                View Full Report
              </Link>
            )}
          </div>
          {latestReport ? (
            <div className="mt-3">
              <p className="text-xs text-gray-400 dark:text-neutral-500">
                {new Date(latestReport.generated_at).toLocaleDateString()} &middot; {latestReport.report_data.articleCount} articles analyzed
              </p>
              <p className="mt-2 text-sm leading-relaxed text-gray-700 dark:text-neutral-300 line-clamp-3">
                {latestReport.report_data.executiveSummary}
              </p>
              {latestReport.report_data.emergingTopics?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {latestReport.report_data.emergingTopics.slice(0, 5).map((t) => (
                    <span key={t} className="rounded-full bg-amber-100 dark:bg-amber-900 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-400 dark:text-neutral-500">No reports generated yet.</p>
          )}
        </div>

        {/* Trending Keywords Bar Chart */}
        <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase text-gray-500 dark:text-neutral-400">Top Keywords</h2>
            <Link href="/reports" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
              Reports
            </Link>
          </div>
          {topKeywords.length > 0 ? (
            <div className="mt-3 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topKeywords} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="keyword" width={80} tick={{ fontSize: 11, fill: "#9ca3af" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--tooltip-bg, #fff)", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => [value, "7d mentions"]}
                  />
                  <Bar dataKey="count7d" fill="#7c3aed" radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-400 dark:text-neutral-500">No keyword data yet.</p>
          )}
        </div>
      </div>

      {/* Row 3: Source Distribution + Sentiment + Draft Status */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Source Distribution Donut */}
        <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase text-gray-500 dark:text-neutral-400">Sources</h2>
            <Link href="/feed" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
              Feed
            </Link>
          </div>
          {sourceDist.length > 0 ? (
            <div className="mt-2 flex items-center gap-4">
              <div className="h-36 w-36 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sourceDist}
                      dataKey="count"
                      nameKey="source_platform"
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={55}
                      strokeWidth={0}
                    >
                      {sourceDist.map((entry) => (
                        <Cell key={entry.source_platform} fill={SOURCE_COLORS[entry.source_platform] || "#9ca3af"} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => [value, "articles"]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1 overflow-hidden">
                {sourceDist.slice(0, 6).map((s) => (
                  <div key={s.source_platform} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: SOURCE_COLORS[s.source_platform] || "#9ca3af" }} />
                    <span className="truncate text-gray-600 dark:text-neutral-400">{s.source_platform}</span>
                    <span className="ml-auto font-medium text-gray-900 dark:text-neutral-100">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-400 dark:text-neutral-500">No articles yet.</p>
          )}
        </div>

        {/* Sentiment Breakdown */}
        <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase text-gray-500 dark:text-neutral-400">Sentiment</h2>
            <Link href="/feed" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
              Feed
            </Link>
          </div>
          {sentimentDist.length > 0 ? (
            <div className="mt-4">
              {(() => {
                const total = sentimentDist.reduce((a, b) => a + b.count, 0);
                return (
                  <>
                    <div className="flex h-4 overflow-hidden rounded-full">
                      {sentimentDist.map((s) => (
                        <div
                          key={s.sentiment}
                          className="transition-all"
                          style={{
                            width: `${(s.count / total) * 100}%`,
                            backgroundColor: SENTIMENT_COLORS[s.sentiment] || "#6b7280",
                          }}
                        />
                      ))}
                    </div>
                    <div className="mt-4 space-y-2">
                      {sentimentDist.map((s) => (
                        <div key={s.sentiment} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SENTIMENT_COLORS[s.sentiment] || "#6b7280" }} />
                            <span className="capitalize text-gray-600 dark:text-neutral-400">{s.sentiment}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 dark:text-neutral-100">{s.count.toLocaleString()}</span>
                            <span className="text-xs text-gray-400 dark:text-neutral-500">({((s.count / total) * 100).toFixed(0)}%)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-400 dark:text-neutral-500">No sentiment data yet.</p>
          )}
        </div>

        {/* Draft Status */}
        <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase text-gray-500 dark:text-neutral-400">Drafts</h2>
            <Link href="/drafts" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
              All Drafts
            </Link>
          </div>
          {draftStatus.length > 0 ? (
            <div className="mt-4 space-y-3">
              {draftStatus.map((d) => {
                const total = draftStatus.reduce((a, b) => a + b.count, 0);
                const pct = total > 0 ? (d.count / total) * 100 : 0;
                return (
                  <div key={d.status}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="capitalize text-gray-600 dark:text-neutral-400">{d.status}</span>
                      <span className="font-medium text-gray-900 dark:text-neutral-100">{d.count}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: STATUS_COLORS[d.status] || "#6b7280" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-400 dark:text-neutral-500">No drafts yet.</p>
          )}
        </div>
      </div>

      {/* Row 4: Trending Topics + Recent Articles */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Trending Topics */}
        <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase text-gray-500 dark:text-neutral-400">Trending Topics</h2>
            <Link href="/explore" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
              Explore
            </Link>
          </div>
          {topTopics.length > 0 ? (
            <div className="mt-3 space-y-2.5">
              {topTopics.map((t, i) => {
                const maxScore = topTopics[0].trendScore;
                return (
                  <div key={t.topic} className="flex items-center gap-3">
                    <span className="w-5 text-right text-xs font-medium text-gray-400 dark:text-neutral-500">{i + 1}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-800 dark:text-neutral-200">{t.topic}</span>
                        <div className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            t.sentiment === "positive" ? "bg-green-500" :
                            t.sentiment === "negative" ? "bg-red-500" : "bg-gray-400"
                          }`} />
                          <span className="text-xs text-gray-500 dark:text-neutral-400">{t.trendScore.toFixed(1)}</span>
                        </div>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${(t.trendScore / maxScore) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-400 dark:text-neutral-500">No topic data yet.</p>
          )}
        </div>

        {/* Recent Articles */}
        <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase text-gray-500 dark:text-neutral-400">Recent Articles</h2>
            <Link href="/feed" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
              All Articles
            </Link>
          </div>
          {recentArticles.length > 0 ? (
            <div className="mt-3 divide-y divide-gray-100 dark:divide-neutral-800">
              {recentArticles.map((a) => (
                <div key={a.id} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-neutral-200 line-clamp-1">{a.title}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-400 dark:text-neutral-500">
                    <span className="capitalize">{a.source_platform}</span>
                    <span>&middot;</span>
                    <span className={
                      a.sentiment === "positive" ? "text-green-600 dark:text-green-400" :
                      a.sentiment === "negative" ? "text-red-600 dark:text-red-400" : ""
                    }>{a.sentiment}</span>
                    <span>&middot;</span>
                    <span>{new Date(a.published_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-400 dark:text-neutral-500">No articles yet.</p>
          )}
        </div>
      </div>

    </>
  );
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const total = Math.floor((end - start) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function LiveDuration({ startedAt, completedAt, status }: { startedAt: string; completedAt: string | null; status: string }) {
  const [display, setDisplay] = useState(() => formatDuration(startedAt, completedAt));

  useEffect(() => {
    if (status !== "running") {
      setDisplay(formatDuration(startedAt, completedAt));
      return;
    }
    const timer = setInterval(() => setDisplay(formatDuration(startedAt, null)), 1000);
    return () => clearInterval(timer);
  }, [startedAt, completedAt, status]);

  return (
    <span className="tabular-nums">
      {display}
      {status === "running" && <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />}
    </span>
  );
}
