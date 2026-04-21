"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { TrendingKeyword } from "@pulsar/shared/types";

export default function KeywordsChart({ data }: { data: TrendingKeyword[] }) {
  const items = data.slice(0, 10);
  if (items.length === 0) return null;

  return (
    <div>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={items} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="keyword" width={100} tick={{ fontSize: 12, fill: "#9ca3af" }} />
            <Tooltip
              contentStyle={{ backgroundColor: "var(--tooltip-bg, #fff)", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
            />
            <Legend
              verticalAlign="top"
              height={28}
              wrapperStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="count30d" name="Last 30 days" fill="#c7d2fe" radius={[0, 4, 4, 0]} barSize={10} />
            <Bar dataKey="count7d" name="Last 7 days" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={10} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-gray-400 dark:text-neutral-500 italic">
        Top keywords by 7-day and 30-day mention volume across all tracked sources.
      </p>
    </div>
  );
}
