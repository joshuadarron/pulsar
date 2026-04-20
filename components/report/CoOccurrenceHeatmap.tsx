"use client";

import type { TopicCoOccurrence } from "@/types";

export default function CoOccurrenceHeatmap({ data }: { data: TopicCoOccurrence[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-neutral-300 uppercase">Topic Co-occurrence</h3>
      <div className="space-y-2">
        {data.slice(0, 10).map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-24 truncate text-right text-xs text-gray-600 dark:text-neutral-400">{item.topicA}</span>
            <div className="flex-1">
              <div
                className="h-6 rounded"
                style={{
                  width: `${(item.count / maxCount) * 100}%`,
                  backgroundColor: `rgba(99, 102, 241, ${0.3 + (item.count / maxCount) * 0.7})`,
                }}
              />
            </div>
            <span className="w-24 truncate text-xs text-gray-600 dark:text-neutral-400">{item.topicB}</span>
            <span className="w-8 text-right text-xs font-medium text-gray-500 dark:text-neutral-400">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
