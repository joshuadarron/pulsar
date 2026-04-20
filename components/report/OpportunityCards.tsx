"use client";

import type { ContentOpportunity } from "@/types";

export default function OpportunityCards({ data }: { data: ContentOpportunity[] }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-neutral-300 uppercase">Content Opportunities</h3>
      <div className="space-y-3">
        {data.map((opp, i) => (
          <div key={i} className="rounded-lg border border-gray-100 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-800 p-4">
            <p className="text-sm font-medium text-gray-900 dark:text-neutral-100">{opp.signal}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-neutral-400">{opp.source}</span>
              {opp.url && (
                <a href={opp.url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline">
                  View source
                </a>
              )}
            </div>
          </div>
        ))}
        {data.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-neutral-500">No opportunities identified yet.</p>
        )}
      </div>
    </div>
  );
}
