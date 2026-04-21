"use client";

import type { TrendingTechnology } from "@pulsar/shared/types";

const TYPE_COLORS: Record<string, string> = {
  tool: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  model: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  language: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  company: "bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-neutral-300",
  concept: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

export default function TechTable({ data }: { data: TrendingTechnology[] }) {
  const items = data.slice(0, 8);
  if (items.length === 0) return null;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 dark:border-neutral-700">
          <th className="pb-2 text-left text-xs font-medium uppercase text-gray-400 dark:text-neutral-500 w-8">#</th>
          <th className="pb-2 text-left text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">Technology</th>
          <th className="pb-2 text-left text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">Type</th>
          <th className="pb-2 text-right text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">Mentions</th>
        </tr>
      </thead>
      <tbody>
        {items.map((tech, i) => (
          <tr key={tech.name} className="border-b border-gray-100 dark:border-neutral-800 last:border-0">
            <td className="py-2 text-gray-400 dark:text-neutral-500">{i + 1}</td>
            <td className="py-2 font-medium text-gray-900 dark:text-neutral-100">{tech.name}</td>
            <td className="py-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[tech.type] || TYPE_COLORS.concept}`}>
                {tech.type}
              </span>
            </td>
            <td className="py-2 text-right tabular-nums text-gray-700 dark:text-neutral-300">{tech.mentionCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
