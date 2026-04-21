"use client";

import type { TrendingTopic } from "@pulsar/shared/types";

export default function TopicsSparkline({ data }: { data: TrendingTopic[] }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-neutral-300 uppercase">Trending Topics</h3>
      <div className="space-y-3">
        {data.slice(0, 5).map((topic, i) => (
          <div key={topic.topic} className="flex items-center gap-3">
            <span className="w-6 text-right text-sm font-medium text-gray-400 dark:text-neutral-500">{i + 1}</span>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900 dark:text-neutral-100">{topic.topic}</span>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    topic.sentiment === "positive" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                    topic.sentiment === "negative" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                    "bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-400"
                  }`}>
                    {topic.sentiment}
                  </span>
                  <span className="text-sm font-semibold text-indigo-600">
                    {topic.trendScore.toFixed(1)}
                  </span>
                </div>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100 dark:bg-neutral-800">
                <div
                  className="h-1.5 rounded-full bg-indigo-500"
                  style={{ width: `${Math.min(100, (topic.trendScore / (data[0]?.trendScore || 1)) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
