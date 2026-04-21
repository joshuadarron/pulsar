"use client";

import type { ReportData } from "@pulsar/shared/types";

export default function ReportMetrics({ data }: { data: ReportData }) {
  const metrics = [
    { label: "Articles Analyzed", value: data.articleCount },
    { label: "Trending Keywords", value: data.trendingKeywords.length },
    { label: "Active Topics", value: data.trendingTopics.length },
    { label: "Entities Tracked", value: data.entityProminence.length },
    { label: "Sources", value: data.sourceDistribution.length },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 rounded-lg bg-gray-50 dark:bg-neutral-900 p-4">
      {metrics.map((m) => (
        <div key={m.label} className="text-center">
          <p className="text-3xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{m.value.toLocaleString()}</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-neutral-400">{m.label}</p>
        </div>
      ))}
    </div>
  );
}
