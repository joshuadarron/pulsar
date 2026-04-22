"use client";

import type { ReportData } from "@pulsar/shared/types";

export default function ReportMetrics({ data }: { data: ReportData }) {
	const meta = data.reportMetadata;
	const sections = data.sections;

	const metrics = [
		{ label: "Articles Analyzed", value: meta?.articleCount ?? 0 },
		{ label: "Trending Keywords", value: sections?.technologyTrends?.data?.keywords?.length ?? 0 },
		{ label: "Active Topics", value: sections?.technologyTrends?.data?.topics?.length ?? 0 },
		{ label: "Entities Tracked", value: sections?.marketLandscape?.data?.entities?.length ?? 0 },
		{ label: "Sources", value: meta?.sourcesCount ?? sections?.marketLandscape?.data?.sourceDistribution?.length ?? 0 },
	];

	return (
		<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 rounded-lg bg-gray-50 dark:bg-neutral-900 p-4">
			{metrics.map((m) => (
				<div key={m.label} className="text-center">
					<p className="text-3xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{m.value.toLocaleString()}</p>
					<p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-neutral-400">{m.label}</p>
				</div>
			))}
		</div>
	);
}
