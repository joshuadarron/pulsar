"use client";

import type { ReportData } from "@pulsar/shared/types";
import ReportMetrics from "./ReportMetrics";
import KeywordsChart from "./KeywordsChart";
import TechTable from "./TechTable";
import OpportunityCards from "./OpportunityCards";

export default function ReportView({ data, reportId }: { data: ReportData; reportId: string }) {
  const periodStart = new Date(data.period.start).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const periodEnd = new Date(data.period.end).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-6">
      {/* Section 1: Header */}
      <div className="report-header rounded-t-lg bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white">
        <h1 className="text-2xl font-bold">Pulsar Intelligence Report</h1>
        <p className="mt-2 text-indigo-100">{periodStart} — {periodEnd}</p>
      </div>

      {/* Section 2: Key Metrics */}
      <div className="report-section -mt-6">
        <ReportMetrics data={data} />
      </div>

      {/* Section 3: Executive Summary */}
      <div className="report-section rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-neutral-100">Executive Summary</h2>
        <div className="mt-4 space-y-3">
          {data.executiveSummary.split("\n\n").map((paragraph, i) => (
            <p key={i} className="text-base leading-relaxed text-gray-700 dark:text-neutral-300">
              {paragraph}
            </p>
          ))}
        </div>
      </div>

      {/* Section 4: Keyword & Topic Landscape */}
      <div className="report-section rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-neutral-100">Keyword & Topic Landscape</h2>

        {data.narrativeAnalysis.keywords && (
          <div className="mt-4 space-y-3">
            {data.narrativeAnalysis.keywords.split("\n\n").map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-gray-600 dark:text-neutral-400">{p}</p>
            ))}
          </div>
        )}

        {data.trendingKeywords.length > 0 && (
          <div className="mt-6">
            <KeywordsChart data={data.trendingKeywords} />
          </div>
        )}

        {data.narrativeAnalysis.topics && (
          <div className="mt-6 space-y-3">
            {data.narrativeAnalysis.topics.split("\n\n").map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-gray-600 dark:text-neutral-400">{p}</p>
            ))}
          </div>
        )}

        {data.emergingTopics.length > 0 && (
          <p className="mt-4 text-sm leading-relaxed text-gray-600 dark:text-neutral-400">
            Several emerging themes are gaining traction:{" "}
            {data.emergingTopics.map((topic, i) => (
              <span key={topic}>
                <span className="rounded bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 text-sm font-medium text-amber-800 dark:text-amber-200">
                  {topic}
                </span>
                {i < data.emergingTopics.length - 1 && (i === data.emergingTopics.length - 2 ? ", and " : ", ")}
              </span>
            ))}
            .
          </p>
        )}
      </div>

      {/* Section 5: Technology & Entity Analysis */}
      <div className="report-section rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-neutral-100">Technology & Entity Analysis</h2>

        {data.narrativeAnalysis.technologies && (
          <div className="mt-4 space-y-3">
            {data.narrativeAnalysis.technologies.split("\n\n").map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-gray-600 dark:text-neutral-400">{p}</p>
            ))}
          </div>
        )}

        {data.trendingTechnologies.length >= 3 && (
          <div className="mt-6">
            <TechTable data={data.trendingTechnologies} />
          </div>
        )}

        {data.entityProminence.length > 0 && (
          <p className="mt-4 text-sm leading-relaxed text-gray-600 dark:text-neutral-400">
            Key entities this period include{" "}
            {data.entityProminence.slice(0, 5).map((e, i, arr) => (
              <span key={e.name}>
                <strong className="text-gray-800 dark:text-neutral-200">{e.name}</strong>
                {" "}({e.mentionCount} mentions)
                {i < arr.length - 1 && (i === arr.length - 2 ? ", and " : ", ")}
              </span>
            ))}
            .
          </p>
        )}
      </div>

      {/* Section 6: Content Opportunities */}
      <div className="report-section rounded-lg border border-gray-200 dark:border-neutral-700 border-l-4 border-l-indigo-500 bg-white dark:bg-neutral-900 p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-neutral-100">Content Opportunities</h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-neutral-400">
          Based on the trends identified above, the following content opportunities have been identified:
        </p>
        <div className="mt-4">
          <OpportunityCards data={data.contentOpportunities} />
        </div>
        {data.narrativeAnalysis.opportunities && (
          <div className="mt-4 space-y-3">
            {data.narrativeAnalysis.opportunities.split("\n\n").map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-gray-600 dark:text-neutral-400">{p}</p>
            ))}
          </div>
        )}
      </div>

      {/* Section 7: Data Sources */}
      {data.sourceDistribution.length > 0 && (
        <div className="report-section rounded-lg bg-gray-50 dark:bg-neutral-800 p-6">
          <h2 className="text-sm font-semibold uppercase text-gray-400 dark:text-neutral-500">Data Sources</h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-neutral-700">
                <th className="pb-2 text-left text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">Source</th>
                <th className="pb-2 text-right text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">Articles</th>
              </tr>
            </thead>
            <tbody>
              {data.sourceDistribution
                .sort((a, b) => b.articleCount - a.articleCount)
                .map((s) => (
                  <tr key={s.source} className="border-b border-gray-100 dark:border-neutral-700 last:border-0">
                    <td className="py-1.5 text-gray-600 dark:text-neutral-400">{s.source}</td>
                    <td className="py-1.5 text-right tabular-nums text-gray-600 dark:text-neutral-400">{s.articleCount}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-gray-400 dark:text-neutral-500">
            Data collected from {data.sourceDistribution.length} sources across the reporting period.
          </p>
        </div>
      )}

      {/* Export */}
      <div className="no-print flex justify-end gap-3">
        <a
          href={`/api/reports/${reportId}/export/pdf`}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Export PDF
        </a>
      </div>
    </div>
  );
}
