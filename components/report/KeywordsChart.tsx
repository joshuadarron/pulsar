"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { TrendingKeyword } from "@/types";

export default function KeywordsChart({ data }: { data: TrendingKeyword[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-700 uppercase">Trending Keywords (7d)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data.slice(0, 15)} layout="vertical" margin={{ left: 80 }}>
          <XAxis type="number" />
          <YAxis type="category" dataKey="keyword" width={80} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="count7d" fill="#6366f1" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
