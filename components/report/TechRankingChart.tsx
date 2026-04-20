"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { TrendingTechnology } from "@/types";

export default function TechRankingChart({ data }: { data: TrendingTechnology[] }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-neutral-300 uppercase">Top Technologies</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data.slice(0, 5)} layout="vertical" margin={{ left: 80 }}>
          <XAxis type="number" />
          <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="mentionCount" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
