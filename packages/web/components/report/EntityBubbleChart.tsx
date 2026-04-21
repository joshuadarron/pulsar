"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { EntityProminence } from "@pulsar/shared/types";

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"];

export default function EntityBubbleChart({ data }: { data: EntityProminence[] }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-neutral-300 uppercase">Entity Prominence</h3>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data.slice(0, 5)} margin={{ left: 80 }}>
          <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
          <YAxis />
          <Tooltip />
          <Bar dataKey="mentionCount" radius={[4, 4, 0, 0]} barSize={20}>
            {data.slice(0, 5).map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
