"use client";

import type { ReportData } from "@pulsar/shared/types";
import ReportMetrics from "./ReportMetrics";
import KeywordsChart from "./KeywordsChart";
import TechTable from "./TechTable";

export default function ReportView({ data, reportId, generatedAt }: { data: ReportData; reportId: string; generatedAt?: string }) {
	const reportDate = new Date(generatedAt || Date.now()).toLocaleDateString("en-US", {
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	});

	// Guard: handle old-format reports gracefully
	const sections = data.sections;
	if (!sections) {
		return (
			<div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
				<p className="text-gray-500 dark:text-neutral-400">This report uses an older format and cannot be displayed.</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="report-header rounded-t-lg bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white">
				<h1 className="text-2xl font-bold">Pulsar: Market Analysis Report</h1>
				<p className="mt-2 text-indigo-100">{reportDate}</p>
			</div>

			{/* Key Metrics */}
			<div className="report-section -mt-6">
				<ReportMetrics data={data} />
			</div>

			{/* Executive Summary */}
			{sections.executiveSummary?.text && (
				<div className="report-section rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
					<h2 className="text-xl font-semibold text-gray-900 dark:text-neutral-100">Executive Summary</h2>
					<div className="mt-4 space-y-3">
						{sections.executiveSummary.text.split("\n\n").map((paragraph, i) => (
							<p key={i} className="text-base leading-relaxed text-gray-700 dark:text-neutral-300">
								{paragraph}
							</p>
						))}
					</div>
				</div>
			)}

			{/* Market Landscape */}
			{sections.marketLandscape && (
				<div className="report-section rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
					<h2 className="text-xl font-semibold text-gray-900 dark:text-neutral-100">Market Landscape</h2>

					{sections.marketLandscape.text && (
						<div className="mt-4 space-y-3">
							{sections.marketLandscape.text.split("\n\n").map((p, i) => (
								<p key={i} className="text-sm leading-relaxed text-gray-600 dark:text-neutral-400">{p}</p>
							))}
						</div>
					)}

					{sections.marketLandscape.data?.technologies?.length >= 3 && (
						<div className="mt-6">
							<TechTable data={sections.marketLandscape.data.technologies} />
						</div>
					)}

					{sections.marketLandscape.data?.entities?.length > 0 && (
						<p className="mt-4 text-sm leading-relaxed text-gray-600 dark:text-neutral-400">
							Key entities this period include{" "}
							{sections.marketLandscape.data.entities.slice(0, 5).map((e, i, arr) => (
								<span key={e.name}>
									<strong className="text-gray-800 dark:text-neutral-200">{e.name}</strong>
									{" "}({e.mentionCount} mentions)
									{i < arr.length - 1 && (i === arr.length - 2 ? ", and " : ", ")}
								</span>
							))}
							.
						</p>
					)}
				</div>
			)}

			{/* Technology Trends */}
			{sections.technologyTrends && (
				<div className="report-section rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
					<h2 className="text-xl font-semibold text-gray-900 dark:text-neutral-100">Technology Trends</h2>

					{sections.technologyTrends.text && (
						<div className="mt-4 space-y-3">
							{sections.technologyTrends.text.split("\n\n").map((p, i) => (
								<p key={i} className="text-sm leading-relaxed text-gray-600 dark:text-neutral-400">{p}</p>
							))}
						</div>
					)}

					{sections.technologyTrends.data?.keywords?.length > 0 && (
						<div className="mt-6">
							<KeywordsChart data={sections.technologyTrends.data.keywords} />
						</div>
					)}

					{sections.technologyTrends.data?.emergingTopics?.length > 0 && (
						<p className="mt-4 text-sm leading-relaxed text-gray-600 dark:text-neutral-400">
							Emerging themes gaining traction:{" "}
							{sections.technologyTrends.data.emergingTopics.map((topic, i, arr) => (
								<span key={topic}>
									<span className="rounded bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 text-sm font-medium text-amber-800 dark:text-amber-200">
										{topic}
									</span>
									{i < arr.length - 1 && (i === arr.length - 2 ? ", and " : ", ")}
								</span>
							))}
							.
						</p>
					)}
				</div>
			)}

			{/* Developer Signals */}
			{sections.developerSignals && (
				<div className="report-section rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
					<h2 className="text-xl font-semibold text-gray-900 dark:text-neutral-100">Developer Signals</h2>

					{sections.developerSignals.text && (
						<div className="mt-4 space-y-3">
							{sections.developerSignals.text.split("\n\n").map((p, i) => (
								<p key={i} className="text-sm leading-relaxed text-gray-600 dark:text-neutral-400">{p}</p>
							))}
						</div>
					)}

					{sections.developerSignals.data?.sentimentBreakdown && (() => {
						const sb = sections.developerSignals.data.sentimentBreakdown;
						const total = sb.positive + sb.negative + sb.neutral;
						if (total === 0) return null;
						return (
							<div className="mt-4 flex items-center gap-2 text-xs">
								<div className="h-3 rounded-l bg-green-500" style={{ width: `${(sb.positive / total) * 200}px` }} />
								<div className="h-3 bg-gray-300 dark:bg-neutral-600" style={{ width: `${(sb.neutral / total) * 200}px` }} />
								<div className="h-3 rounded-r bg-red-500" style={{ width: `${(sb.negative / total) * 200}px` }} />
								<span className="ml-2 text-gray-500 dark:text-neutral-400">
									{Math.round((sb.positive / total) * 100)}% positive, {Math.round((sb.neutral / total) * 100)}% neutral, {Math.round((sb.negative / total) * 100)}% negative
								</span>
							</div>
						);
					})()}
				</div>
			)}

			{/* Content Recommendations */}
			{sections.contentRecommendations?.text && (
				<div className="report-section rounded-lg border border-gray-200 dark:border-neutral-700 border-l-4 border-l-indigo-500 bg-white dark:bg-neutral-900 p-6">
					<h2 className="text-xl font-semibold text-gray-900 dark:text-neutral-100">Content Recommendations</h2>
					<ContentRecommendations text={sections.contentRecommendations.text} />
				</div>
			)}

			{/* Data Sources */}
			{sections.marketLandscape?.data?.sourceDistribution?.length > 0 && (
				<div className="report-section rounded-lg bg-gray-50 dark:bg-neutral-800 p-6">
					<h2 className="text-sm font-semibold uppercase text-gray-400 dark:text-neutral-500">Data Sources</h2>
					<table className="mt-3 w-full text-sm">
						<thead>
							<tr className="border-b border-gray-200 dark:border-neutral-700">
								<th className="pb-2 text-left text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">Source</th>
								<th className="pb-2 text-right text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">Articles</th>
							</tr>
						</thead>
						<tbody>
							{sections.marketLandscape.data.sourceDistribution
								.sort((a, b) => b.articleCount - a.articleCount)
								.map((s) => (
									<tr key={s.source} className="border-b border-gray-100 dark:border-neutral-700 last:border-0">
										<td className="py-1.5 text-gray-600 dark:text-neutral-400">{s.source}</td>
										<td className="py-1.5 text-right tabular-nums text-gray-600 dark:text-neutral-400">{s.articleCount}</td>
									</tr>
								))}
						</tbody>
					</table>
					<p className="mt-3 text-xs text-gray-400 dark:text-neutral-500">
						Data collected from {sections.marketLandscape.data.sourceDistribution.length} sources across the reporting period.
					</p>
				</div>
			)}

			{/* Export */}
			<div className="no-print flex justify-end gap-3">
				<a
					href={`/api/reports/${reportId}/export/pdf`}
					className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
				>
					Export PDF
				</a>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Content recommendations: parse numbered items into cards with bold handling.
// Falls back to plain paragraphs if no numbered pattern is detected.
// ---------------------------------------------------------------------------

interface Recommendation {
	number: number;
	title: string;
	body: string;
}

function parseRecommendations(text: string): { preamble: string; items: Recommendation[]; postscript: string } {
	// Split on numbered item headers: **1. "Title" (format)** or **1. "Title"**
	const itemPattern = /\*\*(\d+)\.\s+(.+?)\*\*/g;
	const matches = [...text.matchAll(itemPattern)];

	if (matches.length === 0) {
		return { preamble: text, items: [], postscript: "" };
	}

	const preamble = text.slice(0, matches[0].index).trim();
	const items: Recommendation[] = [];

	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const bodyStart = match.index! + match[0].length;
		const bodyEnd = i < matches.length - 1 ? matches[i + 1].index! : text.length;
		let body = text.slice(bodyStart, bodyEnd).trim();

		// Check if the last item's body contains a prioritization note
		let postCandidate = "";
		if (i === matches.length - 1) {
			const prioMatch = body.match(/\n\n\*\*Prioritization note:\*\*/i);
			if (prioMatch && prioMatch.index !== undefined) {
				postCandidate = body.slice(prioMatch.index).trim();
				body = body.slice(0, prioMatch.index).trim();
			}
		}

		items.push({
			number: parseInt(match[1]),
			title: match[2].replace(/^[""\u201c]|[""\u201d]$/g, "").trim(),
			body,
		});

		if (postCandidate) {
			return { preamble, items, postscript: postCandidate };
		}
	}

	return { preamble, items, postscript: "" };
}

function renderInlineBold(text: string): React.ReactNode[] {
	const parts = text.split(/\*\*(.+?)\*\*/g);
	return parts.map((part, i) =>
		i % 2 === 1
			? <strong key={i} className="text-gray-800 dark:text-neutral-200">{part}</strong>
			: <span key={i}>{part}</span>
	);
}

function ContentRecommendations({ text }: { text: string }) {
	const { preamble, items, postscript } = parseRecommendations(text);

	// Fallback: no numbered items found, render as bold-aware paragraphs
	if (items.length === 0) {
		return (
			<div className="mt-4 space-y-3">
				{text.split("\n\n").map((p, i) => (
					<p key={i} className="text-sm leading-relaxed text-gray-600 dark:text-neutral-400">
						{renderInlineBold(p)}
					</p>
				))}
			</div>
		);
	}

	return (
		<div className="mt-4 space-y-4">
			{preamble && (
				<p className="text-sm leading-relaxed text-gray-600 dark:text-neutral-400">
					{renderInlineBold(preamble)}
				</p>
			)}

			{items.map((item) => (
				<div key={item.number} className="rounded-lg border border-gray-200 dark:border-neutral-700 border-l-4 border-l-indigo-500 bg-white dark:bg-neutral-800 p-4">
					<div className="flex items-start gap-3">
						<span className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900 text-xs font-bold text-indigo-700 dark:text-indigo-300">
							{item.number}
						</span>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-semibold text-gray-900 dark:text-neutral-100">{item.title}</p>
							<div className="mt-2 space-y-2">
								{item.body.split("\n\n").filter((p) => p.trim()).map((p, i) => (
									<p key={i} className="text-sm leading-relaxed text-gray-600 dark:text-neutral-400">
										{renderInlineBold(p)}
									</p>
								))}
							</div>
						</div>
					</div>
				</div>
			))}

			{postscript && (
				<div className="rounded-lg bg-gray-50 dark:bg-neutral-800 p-4">
					{postscript.split("\n\n").filter((p) => p.trim()).map((p, i) => (
						<p key={i} className="text-sm leading-relaxed text-gray-600 dark:text-neutral-400">
							{renderInlineBold(p)}
						</p>
					))}
				</div>
			)}
		</div>
	);
}
