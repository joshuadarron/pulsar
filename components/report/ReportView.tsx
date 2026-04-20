"use client";

import type { ReportData } from "@/types";
import KeywordsChart from "./KeywordsChart";
import TopicsSparkline from "./TopicsSparkline";
import TechRankingChart from "./TechRankingChart";
import EntityBubbleChart from "./EntityBubbleChart";
import CoOccurrenceHeatmap from "./CoOccurrenceHeatmap";
import VelocityTable from "./VelocityTable";
import OpportunityCards from "./OpportunityCards";
import SourceDonut from "./SourceDonut";

export default function ReportView({ data, reportId }: { data: ReportData; reportId: string }) {
  return (
    <div className="space-y-6">
      {/* Executive Summary */}
      <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100">Executive Summary</h2>
        <p className="mt-2 text-gray-700 dark:text-neutral-300 leading-relaxed">{data.executiveSummary}</p>
        <div className="mt-4 flex gap-4">
          <span className="text-sm text-gray-500 dark:text-neutral-400">
            Period: {new Date(data.period.start).toLocaleDateString()} — {new Date(data.period.end).toLocaleDateString()}
          </span>
          <span className="text-sm text-gray-500 dark:text-neutral-400">{data.articleCount} articles analyzed</span>
        </div>
      </div>

      {/* Emerging Topics */}
      {data.emergingTopics.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-5">
          <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 uppercase">Emerging Topics</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.emergingTopics.map((topic) => (
              <span key={topic} className="rounded-full bg-amber-200 dark:bg-amber-800 px-3 py-1 text-sm font-medium text-amber-800 dark:text-amber-200">
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <KeywordsChart data={data.trendingKeywords} />
        <TopicsSparkline data={data.trendingTopics} />
        <TechRankingChart data={data.trendingTechnologies} />
        <EntityBubbleChart data={data.entityProminence} />
        <CoOccurrenceHeatmap data={data.topicCoOccurrence} />
        <VelocityTable data={data.velocityOutliers} />
        <SourceDonut data={data.sourceDistribution} />
        <OpportunityCards data={data.contentOpportunities} />
      </div>

      {/* Narrative Analysis */}
      {data.narrativeAnalysis && (
        <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100">Narrative Analysis</h2>
          <div className="mt-4 space-y-4">
            {data.narrativeAnalysis.keywords && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-neutral-300">Keywords</h4>
                <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400 leading-relaxed whitespace-pre-line">{data.narrativeAnalysis.keywords}</p>
              </div>
            )}
            {data.narrativeAnalysis.topics && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-neutral-300">Topics</h4>
                <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400 leading-relaxed whitespace-pre-line">{data.narrativeAnalysis.topics}</p>
              </div>
            )}
            {data.narrativeAnalysis.technologies && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-neutral-300">Technologies</h4>
                <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400 leading-relaxed whitespace-pre-line">{data.narrativeAnalysis.technologies}</p>
              </div>
            )}
            {data.narrativeAnalysis.opportunities && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-neutral-300">Opportunities</h4>
                <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400 leading-relaxed whitespace-pre-line">{data.narrativeAnalysis.opportunities}</p>
              </div>
            )}
          </div>
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
