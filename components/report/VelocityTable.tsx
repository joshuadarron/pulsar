"use client";

import type { VelocityOutlier } from "@/types";

export default function VelocityTable({ data }: { data: VelocityOutlier[] }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-neutral-300 uppercase">Velocity Outliers</h3>
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-gray-200 dark:border-neutral-700">
            <th className="pb-2 text-left text-xs font-medium text-gray-500 dark:text-neutral-400">Topic</th>
            <th className="pb-2 text-right text-xs font-medium text-gray-500 dark:text-neutral-400">Current</th>
            <th className="pb-2 text-right text-xs font-medium text-gray-500 dark:text-neutral-400">Baseline</th>
            <th className="pb-2 text-right text-xs font-medium text-gray-500 dark:text-neutral-400">Delta</th>
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 5).map((item) => {
            const delta = item.baseline > 0 ? ((item.spike - item.baseline) / item.baseline) * 100 : 0;
            return (
              <tr key={item.topic} className="border-b border-gray-100 dark:border-neutral-800">
                <td className="py-2 text-sm font-medium text-gray-900 dark:text-neutral-100">{item.topic}</td>
                <td className="py-2 text-right text-sm text-gray-600 dark:text-neutral-400">{item.spike.toFixed(0)}</td>
                <td className="py-2 text-right text-sm text-gray-600 dark:text-neutral-400">{item.baseline.toFixed(0)}</td>
                <td className="py-2 text-right text-sm">
                  <span className={delta > 0 ? "text-green-600" : "text-red-600"}>
                    {delta > 0 ? "+" : ""}{delta.toFixed(0)}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
