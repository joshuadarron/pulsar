"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";

interface ReportTrendPoint {
	judged_at: string;
	dimension: string;
	score: number;
}

interface Props {
	data: ReportTrendPoint[];
}

const DIM_COLORS: Record<string, string> = {
	grounding: "#4f46e5",
	specificity: "#0891b2",
	tone_match: "#16a34a",
	actionability: "#ea580c",
	internal_consistency: "#a855f7",
};

export default function EvalTrendChart({ data }: Props) {
	const byDate = new Map<string, Record<string, number | string>>();
	for (const row of data) {
		const date = new Date(row.judged_at).toISOString().slice(0, 10);
		const entry = byDate.get(date) ?? { date };
		entry[row.dimension] = row.score;
		byDate.set(date, entry);
	}
	const series = Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));

	const dimensions = Array.from(new Set(data.map((d) => d.dimension)));

	if (series.length === 0) {
		return (
			<div className="flex h-64 items-center justify-center text-sm text-gray-400 dark:text-neutral-500">
				No evaluations in this window yet.
			</div>
		);
	}

	return (
		<div className="h-64 w-full">
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={series}>
					<CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
					<XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
					<YAxis domain={[0, 5]} stroke="#9ca3af" fontSize={12} />
					<Tooltip />
					<Legend />
					{dimensions.map((dim) => (
						<Line
							key={dim}
							type="monotone"
							dataKey={dim}
							stroke={DIM_COLORS[dim] ?? "#6b7280"}
							strokeWidth={2}
							dot={{ r: 3 }}
							activeDot={{ r: 5 }}
							connectNulls
						/>
					))}
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
