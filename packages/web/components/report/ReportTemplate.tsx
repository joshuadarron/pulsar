// ---------------------------------------------------------------------------
// Unified report template — single source of truth for UI and email.
//
// variant="ui"    → Tailwind classes, dark mode, interactive elements
// variant="email" → inline styles, single color scheme, static HTML
//
// Any change to section order, data access, or formatting happens HERE.
// ---------------------------------------------------------------------------

import React from "react";
import type {
	ReportData,
	TrendingKeyword,
	TrendingTechnology,
	EntityProminence,
	SourceDistribution,
} from "@pulsar/shared/types";

type V = "ui" | "email";

interface ReportTemplateProps {
	data: ReportData;
	variant: V;
	reportId: string;
	generatedAt?: string;
	reportUrl?: string;
	pdfUrl?: string;
}

// ---------------------------------------------------------------------------
// Style helper: returns className for UI, inline style for email
// ---------------------------------------------------------------------------

function cx(v: V, ui: string, email: React.CSSProperties): Record<string, unknown> {
	return v === "ui" ? { className: ui } : { style: email };
}

// ---------------------------------------------------------------------------
// Text rendering helpers
// ---------------------------------------------------------------------------

function renderBold(v: V, text: string): React.ReactNode[] {
	const parts = text.split(/\*\*(.+?)\*\*/g);
	return parts.map((part, i) =>
		i % 2 === 1
			? <strong key={i} {...cx(v, "text-gray-800 dark:text-neutral-200", { color: "#111827" })}>{part}</strong>
			: <span key={i}>{part}</span>
	);
}

function renderParagraphs(v: V, text: string, style: "body" | "summary" = "body"): React.ReactNode {
	const paragraphs = text.split("\n\n").filter((p) => p.trim());
	const props = style === "summary"
		? cx(v, "text-base leading-relaxed text-gray-700 dark:text-neutral-300", { lineHeight: "1.7", fontSize: "15px", color: "#374151", margin: "0 0 12px" })
		: cx(v, "text-sm leading-relaxed text-gray-600 dark:text-neutral-400", { lineHeight: "1.7", fontSize: "14px", color: "#374151", margin: "0 0 12px" });

	return paragraphs.map((p, i) => <p key={i} {...props}>{renderBold(v, p)}</p>);
}

// ---------------------------------------------------------------------------
// Content recommendations parser (shared between variants)
// ---------------------------------------------------------------------------

interface Recommendation {
	number: number;
	title: string;
	body: string;
}

function parseRecommendations(text: string): { preamble: string; items: Recommendation[]; postscript: string } {
	const itemPattern = /\*\*(\d+)\.\s+(.+?)\*\*/g;
	const matches = [...text.matchAll(itemPattern)];

	if (matches.length === 0) return { preamble: text, items: [], postscript: "" };

	const preamble = text.slice(0, matches[0].index).trim();
	const items: Recommendation[] = [];

	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const bodyStart = match.index! + match[0].length;
		const bodyEnd = i < matches.length - 1 ? matches[i + 1].index! : text.length;
		let body = text.slice(bodyStart, bodyEnd).trim();

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

		if (postCandidate) return { preamble, items, postscript: postCandidate };
	}

	return { preamble, items, postscript: "" };
}

// ---------------------------------------------------------------------------
// Sub-section renderers
// ---------------------------------------------------------------------------

function MetricsBar({ v, data }: { v: V; data: ReportData }) {
	const meta = data.reportMetadata;
	const sections = data.sections;
	const metrics = [
		{ label: "Articles Analyzed", value: meta?.articleCount ?? 0 },
		{ label: "Trending Keywords", value: sections?.technologyTrends?.data?.keywords?.length ?? 0 },
		{ label: "Active Topics", value: sections?.technologyTrends?.data?.topics?.length ?? 0 },
		{ label: "Entities Tracked", value: sections?.marketLandscape?.data?.entities?.length ?? 0 },
		{ label: "Sources", value: meta?.sourcesCount ?? 0 },
	];

	if (v === "email") {
		return (
			<table style={{ width: "100%", borderCollapse: "collapse", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }} cellPadding={0} cellSpacing={0}>
				<tbody>
					<tr>
						{metrics.map((m) => (
							<td key={m.label} style={{ textAlign: "center", padding: "12px 8px", width: "20%" }}>
								<div style={{ fontSize: "28px", fontWeight: 700, color: "#6366f1" }}>{m.value}</div>
								<div style={{ fontSize: "11px", textTransform: "uppercase", color: "#6b7280", marginTop: "4px" }}>{m.label}</div>
							</td>
						))}
					</tr>
				</tbody>
			</table>
		);
	}

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

const TYPE_COLORS: Record<string, string> = {
	tool: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
	model: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
	language: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
	company: "bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-neutral-300",
	concept: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

function TechTableSection({ v, data }: { v: V; data: TrendingTechnology[] }) {
	const items = data.slice(0, 8);
	if (items.length < 3) return null;

	const thStyle: React.CSSProperties = { textAlign: "left", padding: "6px 8px", fontSize: "11px", textTransform: "uppercase", color: "#9ca3af" };
	const tdStyle: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f3f4f6" };

	if (v === "email") {
		return (
			<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", margin: "16px 0" }}>
				<thead>
					<tr style={{ borderBottom: "2px solid #e5e7eb" }}>
						<th style={thStyle}>#</th>
						<th style={thStyle}>Technology</th>
						<th style={thStyle}>Type</th>
						<th style={{ ...thStyle, textAlign: "right" }}>Mentions</th>
					</tr>
				</thead>
				<tbody>
					{items.map((t, i) => (
						<tr key={t.name}>
							<td style={tdStyle}>{i + 1}</td>
							<td style={tdStyle}>{t.name}</td>
							<td style={tdStyle}>{t.type}</td>
							<td style={{ ...tdStyle, textAlign: "right" }}>{t.mentionCount}</td>
						</tr>
					))}
				</tbody>
			</table>
		);
	}

	return (
		<table className="mt-6 w-full text-sm">
			<thead>
				<tr className="border-b border-gray-200 dark:border-neutral-700">
					<th className="pb-2 text-left text-xs font-medium uppercase text-gray-400 dark:text-neutral-500 w-8">#</th>
					<th className="pb-2 text-left text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">Technology</th>
					<th className="pb-2 text-left text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">Type</th>
					<th className="pb-2 text-right text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">Mentions</th>
				</tr>
			</thead>
			<tbody>
				{items.map((t, i) => (
					<tr key={t.name} className="border-b border-gray-100 dark:border-neutral-800 last:border-0">
						<td className="py-2 text-gray-400 dark:text-neutral-500">{i + 1}</td>
						<td className="py-2 font-medium text-gray-900 dark:text-neutral-100">{t.name}</td>
						<td className="py-2">
							<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[t.type] || TYPE_COLORS.concept}`}>{t.type}</span>
						</td>
						<td className="py-2 text-right tabular-nums text-gray-700 dark:text-neutral-300">{t.mentionCount}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function KeywordsTableSection({ v, data }: { v: V; data: TrendingKeyword[] }) {
	const items = data.slice(0, 10);
	if (items.length === 0) return null;

	const arrow = (delta: number) => delta > 0 ? "\u25B2" : delta < 0 ? "\u25BC" : "\u2014";
	const arrowColor = (delta: number) => delta > 0 ? "#10b981" : delta < 0 ? "#ef4444" : "#6b7280";

	const thStyle: React.CSSProperties = { padding: "6px 8px", fontSize: "11px", textTransform: "uppercase", color: "#9ca3af" };
	const tdStyle: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f3f4f6" };

	if (v === "email") {
		return (
			<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", margin: "16px 0" }}>
				<thead>
					<tr style={{ borderBottom: "2px solid #e5e7eb" }}>
						<th style={{ ...thStyle, textAlign: "left" }}>Keyword</th>
						<th style={{ ...thStyle, textAlign: "right" }}>7d</th>
						<th style={{ ...thStyle, textAlign: "right" }}>30d</th>
						<th style={{ ...thStyle, textAlign: "center" }}>Trend</th>
					</tr>
				</thead>
				<tbody>
					{items.map((k) => (
						<tr key={k.keyword}>
							<td style={tdStyle}>{k.keyword}</td>
							<td style={{ ...tdStyle, textAlign: "right" }}>{k.count7d}</td>
							<td style={{ ...tdStyle, textAlign: "right" }}>{k.count30d}</td>
							<td style={{ ...tdStyle, textAlign: "center", color: arrowColor(k.delta) }}>{arrow(k.delta)}</td>
						</tr>
					))}
				</tbody>
			</table>
		);
	}

	return (
		<div className="mt-6">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b border-gray-200 dark:border-neutral-700">
						<th className="pb-2 text-left text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">Keyword</th>
						<th className="pb-2 text-right text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">7d</th>
						<th className="pb-2 text-right text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">30d</th>
						<th className="pb-2 text-right text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">Trend</th>
					</tr>
				</thead>
				<tbody>
					{items.map((k) => {
						const ac = k.delta > 0 ? "text-green-600 dark:text-green-400" : k.delta < 0 ? "text-red-600 dark:text-red-400" : "text-gray-400 dark:text-neutral-500";
						return (
							<tr key={k.keyword} className="border-b border-gray-100 dark:border-neutral-800 last:border-0">
								<td className="py-2 font-medium text-gray-900 dark:text-neutral-100">{k.keyword}</td>
								<td className="py-2 text-right tabular-nums text-gray-700 dark:text-neutral-300">{k.count7d}</td>
								<td className="py-2 text-right tabular-nums text-gray-700 dark:text-neutral-300">{k.count30d}</td>
								<td className={`py-2 text-right ${ac}`}>{arrow(k.delta)}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			<p className="mt-2 text-xs text-gray-400 dark:text-neutral-500 italic">
				Top keywords by 7-day and 30-day mention volume across all tracked sources.
			</p>
		</div>
	);
}

function EntitySentence({ v, data }: { v: V; data: EntityProminence[] }) {
	const items = data.slice(0, 5);
	if (items.length === 0) return null;

	return (
		<p {...cx(v, "mt-4 text-sm leading-relaxed text-gray-600 dark:text-neutral-400", { lineHeight: "1.7", fontSize: "14px", color: "#374151", margin: "16px 0 0" })}>
			Key entities this period include{" "}
			{items.map((e, i, arr) => (
				<span key={e.name}>
					<strong {...cx(v, "text-gray-800 dark:text-neutral-200", { color: "#111827" })}>{e.name}</strong>
					{" "}({e.mentionCount} mentions)
					{i < arr.length - 1 && (i === arr.length - 2 ? ", and " : ", ")}
				</span>
			))}
			.
		</p>
	);
}

function EmergingTopics({ v, data }: { v: V; data: string[] }) {
	if (data.length === 0) return null;

	return (
		<p {...cx(v, "mt-4 text-sm leading-relaxed text-gray-600 dark:text-neutral-400", { marginTop: "16px", fontSize: "14px", lineHeight: "1.7", color: "#374151" })}>
			Emerging themes gaining traction:{" "}
			{data.map((topic, i, arr) => (
				<span key={topic}>
					<span {...cx(v,
						"rounded bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 text-sm font-medium text-amber-800 dark:text-amber-200",
						{ background: "#fef3c7", padding: "2px 6px", borderRadius: "4px", fontWeight: 600 }
					)}>
						{topic}
					</span>
					{i < arr.length - 1 && (i === arr.length - 2 ? ", and " : ", ")}
				</span>
			))}
			.
		</p>
	);
}

function SentimentBar({ v, data }: { v: V; data: { positive: number; negative: number; neutral: number } }) {
	const total = data.positive + data.negative + data.neutral;
	if (total === 0) return null;
	const pPct = Math.round((data.positive / total) * 100);
	const nPct = Math.round((data.neutral / total) * 100);
	const negPct = Math.round((data.negative / total) * 100);

	if (v === "email") {
		return (
			<div>
				<table style={{ width: "100%", borderCollapse: "collapse", margin: "12px 0" }} cellPadding={0} cellSpacing={0}>
					<tbody>
						<tr>
							<td style={{ width: `${pPct}%`, height: "12px", background: "#10b981", borderRadius: "6px 0 0 6px" }} />
							<td style={{ width: `${nPct}%`, height: "12px", background: "#9ca3af" }} />
							<td style={{ width: `${negPct}%`, height: "12px", background: "#ef4444", borderRadius: "0 6px 6px 0" }} />
						</tr>
					</tbody>
				</table>
				<p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>{pPct}% positive, {nPct}% neutral, {negPct}% negative</p>
			</div>
		);
	}

	return (
		<div className="mt-4 flex items-center gap-2 text-xs">
			<div className="h-3 rounded-l bg-green-500" style={{ width: `${(data.positive / total) * 200}px` }} />
			<div className="h-3 bg-gray-300 dark:bg-neutral-600" style={{ width: `${(data.neutral / total) * 200}px` }} />
			<div className="h-3 rounded-r bg-red-500" style={{ width: `${(data.negative / total) * 200}px` }} />
			<span className="ml-2 text-gray-500 dark:text-neutral-400">
				{pPct}% positive, {nPct}% neutral, {negPct}% negative
			</span>
		</div>
	);
}

function ContentRecommendationsSection({ v, text }: { v: V; text: string }) {
	const { preamble, items, postscript } = parseRecommendations(text);

	const bodyProps = cx(v, "text-sm leading-relaxed text-gray-600 dark:text-neutral-400", { lineHeight: "1.7", fontSize: "14px", color: "#374151", margin: "0 0 12px" });

	if (items.length === 0) {
		return <div {...cx(v, "mt-4 space-y-3", { marginTop: "16px" })}>{renderParagraphs(v, text)}</div>;
	}

	return (
		<div {...cx(v, "mt-4 space-y-4", { marginTop: "16px" })}>
			{preamble && <p {...bodyProps}>{renderBold(v, preamble)}</p>}

			{items.map((item) => (
				<div key={item.number} {...cx(v,
					"rounded-lg border border-gray-200 dark:border-neutral-700 border-l-4 border-l-indigo-500 bg-white dark:bg-neutral-800 p-4",
					{ borderLeft: "4px solid #6366f1", padding: "12px 16px", marginBottom: "12px", background: "#fafafa", borderRadius: "0 8px 8px 0" }
				)}>
					<div {...cx(v, "flex items-start gap-3", {})}>
						<span {...cx(v,
							"flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900 text-xs font-bold text-indigo-700 dark:text-indigo-300",
							{ display: "inline-block", background: "#e0e7ff", color: "#4338ca", fontSize: "12px", fontWeight: 700, width: "22px", height: "22px", lineHeight: "22px", textAlign: "center", borderRadius: "50%", marginBottom: "8px" }
						)}>
							{item.number}
						</span>
						<div {...cx(v, "min-w-0 flex-1", {})}>
							<p {...cx(v, "text-sm font-semibold text-gray-900 dark:text-neutral-100", { fontSize: "14px", fontWeight: 600, color: "#111827", margin: "0 0 4px" })}>
								{item.title}
							</p>
							{item.body.split("\n\n").filter((p) => p.trim()).map((p, i) => (
								<p key={i} {...cx(v, "mt-2 text-sm leading-relaxed text-gray-600 dark:text-neutral-400", { lineHeight: "1.7", fontSize: "14px", color: "#374151", margin: "8px 0 0" })}>
									{renderBold(v, p)}
								</p>
							))}
						</div>
					</div>
				</div>
			))}

			{postscript && (
				<div {...cx(v, "rounded-lg bg-gray-50 dark:bg-neutral-800 p-4", { background: "#f9fafb", padding: "12px 16px", borderRadius: "8px", marginTop: "8px" })}>
					{postscript.split("\n\n").filter((p) => p.trim()).map((p, i) => (
						<p key={i} {...bodyProps}>{renderBold(v, p)}</p>
					))}
				</div>
			)}
		</div>
	);
}

function SourcesTable({ v, data }: { v: V; data: SourceDistribution[] }) {
	const sorted = [...data].sort((a, b) => b.articleCount - a.articleCount);

	if (v === "email") {
		return (
			<div style={{ padding: "0 24px 24px" }}>
				<h2 style={{ fontSize: "12px", textTransform: "uppercase", color: "#9ca3af", margin: "0 0 8px" }}>Data Sources</h2>
				<table style={{ width: "100%", borderCollapse: "collapse" }}>
					<tbody>
						{sorted.map((s) => (
							<tr key={s.source}>
								<td style={{ padding: "4px 8px", fontSize: "13px", color: "#6b7280" }}>{s.source}</td>
								<td style={{ padding: "4px 8px", fontSize: "13px", color: "#6b7280", textAlign: "right" }}>{s.articleCount}</td>
							</tr>
						))}
					</tbody>
				</table>
				<p style={{ fontSize: "11px", color: "#9ca3af", margin: "8px 0 0" }}>Data collected from {data.length} sources across the reporting period.</p>
			</div>
		);
	}

	return (
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
					{sorted.map((s) => (
						<tr key={s.source} className="border-b border-gray-100 dark:border-neutral-700 last:border-0">
							<td className="py-1.5 text-gray-600 dark:text-neutral-400">{s.source}</td>
							<td className="py-1.5 text-right tabular-nums text-gray-600 dark:text-neutral-400">{s.articleCount}</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="mt-3 text-xs text-gray-400 dark:text-neutral-500">
				Data collected from {data.length} sources across the reporting period.
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main template
// ---------------------------------------------------------------------------

export default function ReportTemplate({ data, variant: v, reportId, generatedAt, reportUrl, pdfUrl }: ReportTemplateProps) {
	const reportDate = new Date(generatedAt || Date.now()).toLocaleDateString("en-US", {
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	});

	const sections = data.sections;
	if (!sections) {
		return <p {...cx(v, "text-gray-500 dark:text-neutral-400", { color: "#6b7280" })}>This report uses an older format and cannot be displayed.</p>;
	}

	const sectionWrap = (children: React.ReactNode) =>
		v === "ui"
			? <div className="report-section rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">{children}</div>
			: <div style={{ padding: "0 24px 24px" }}>{children}</div>;

	const sectionTitle = (text: string) => (
		<h2 {...cx(v, "text-xl font-semibold text-gray-900 dark:text-neutral-100", { fontSize: "18px", fontWeight: 600, color: "#111827", margin: "0 0 12px" })}>
			{text}
		</h2>
	);

	return (
		<>
			{/* Header */}
			<div {...cx(v,
				"report-header rounded-t-lg bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white",
				{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)", padding: "28px 24px", borderRadius: "12px 12px 0 0" }
			)}>
				<h1 {...cx(v, "text-2xl font-bold", { color: "white", margin: 0, fontSize: "24px", fontWeight: 700 })}>
					Pulsar: Market Analysis Report
				</h1>
				<p {...cx(v, "mt-2 text-indigo-100", { color: "rgba(255,255,255,0.8)", margin: "8px 0 0", fontSize: "14px" })}>
					{reportDate}
				</p>
			</div>

			{/* Export PDF */}
			{v === "ui" && (
				<div className="no-print flex justify-end gap-3">
					<a href={`/api/reports/${reportId}/export/pdf`} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
						Export PDF
					</a>
				</div>
			)}

			{/* Key Metrics */}
			{v === "ui" ? (
				<div className="report-section -mt-6">
					<MetricsBar v={v} data={data} />
				</div>
			) : (
				<MetricsBar v={v} data={data} />
			)}

			{/* Executive Summary */}
			{sections.executiveSummary?.text && sectionWrap(
				<>
					{sectionTitle("Executive Summary")}
					<div {...cx(v, "mt-4 space-y-3", { marginTop: "12px" })}>
						{renderParagraphs(v, sections.executiveSummary.text, "summary")}
					</div>
				</>
			)}

			{/* Market Landscape */}
			{sections.marketLandscape && sectionWrap(
				<>
					{sectionTitle("Market Landscape")}
					{sections.marketLandscape.text && (
						<div {...cx(v, "mt-4 space-y-3", { marginTop: "12px" })}>
							{renderParagraphs(v, sections.marketLandscape.text)}
						</div>
					)}
					{sections.marketLandscape.data?.technologies && (
						<TechTableSection v={v} data={sections.marketLandscape.data.technologies} />
					)}
					{sections.marketLandscape.data?.entities && (
						<EntitySentence v={v} data={sections.marketLandscape.data.entities} />
					)}
				</>
			)}

			{/* Technology Trends */}
			{sections.technologyTrends && sectionWrap(
				<>
					{sectionTitle("Technology Trends")}
					{sections.technologyTrends.text && (
						<div {...cx(v, "mt-4 space-y-3", { marginTop: "12px" })}>
							{renderParagraphs(v, sections.technologyTrends.text)}
						</div>
					)}
					{sections.technologyTrends.data?.keywords && (
						<KeywordsTableSection v={v} data={sections.technologyTrends.data.keywords} />
					)}
					{sections.technologyTrends.data?.emergingTopics && (
						<EmergingTopics v={v} data={sections.technologyTrends.data.emergingTopics} />
					)}
				</>
			)}

			{/* Developer Signals */}
			{sections.developerSignals && sectionWrap(
				<>
					{sectionTitle("Developer Signals")}
					{sections.developerSignals.text && (
						<div {...cx(v, "mt-4 space-y-3", { marginTop: "12px" })}>
							{renderParagraphs(v, sections.developerSignals.text)}
						</div>
					)}
					{sections.developerSignals.data?.sentimentBreakdown && (
						<SentimentBar v={v} data={sections.developerSignals.data.sentimentBreakdown} />
					)}
				</>
			)}

			{/* Content Recommendations */}
			{sections.contentRecommendations?.text && (
				v === "ui" ? (
					<div className="report-section rounded-lg border border-gray-200 dark:border-neutral-700 border-l-4 border-l-indigo-500 bg-white dark:bg-neutral-900 p-6">
						{sectionTitle("Content Recommendations")}
						<ContentRecommendationsSection v={v} text={sections.contentRecommendations.text} />
					</div>
				) : (
					<div style={{ padding: "0 24px 24px" }}>
						{sectionTitle("Content Recommendations")}
						<ContentRecommendationsSection v={v} text={sections.contentRecommendations.text} />
					</div>
				)
			)}

			{/* Data Sources */}
			{sections.marketLandscape?.data?.sourceDistribution?.length > 0 && (
				<SourcesTable v={v} data={sections.marketLandscape.data.sourceDistribution} />
			)}

			{/* CTA — email gets buttons, UI gets export link */}
			{v === "email" && reportUrl && (
				<div style={{ padding: "16px 24px 28px", textAlign: "center" }}>
					<a href={reportUrl} style={{ display: "inline-block", background: "#4f46e5", color: "white", padding: "12px 32px", borderRadius: "8px", textDecoration: "none", fontWeight: 600, marginRight: "12px" }}>
						View Full Report
					</a>
					{pdfUrl && (
						<a href={pdfUrl} style={{ display: "inline-block", background: "#f3f4f6", color: "#374151", padding: "12px 32px", borderRadius: "8px", textDecoration: "none", fontWeight: 600 }}>
							Download PDF
						</a>
					)}
				</div>
			)}
		</>
	);
}
