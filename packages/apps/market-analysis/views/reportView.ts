import type {
	LegacyReportData,
	ReportData,
	SignalInterpretation,
	SupportingResource
} from '@pulsar/shared/types';
import { isLegacyReportData } from '@pulsar/shared/types';
import {
	type Block,
	type ChartBlock,
	type ChartSeries,
	type ListItem,
	type ViewModel,
	chart,
	emptyState,
	list,
	markdown,
	section,
	view
} from '@pulsar/view-model';

export const REPORT_VIEW_ID = 'market-analysis.report';

export type BuildReportViewOptions = {
	reportId: string;
	generatedAt?: string;
};

/**
 * Build a shell-renderable view-model for a stored report.
 * Branches on isLegacyReportData() so pre-Phase-4 rows still render.
 */
export function buildReportView(data: ReportData, opts: BuildReportViewOptions): ViewModel {
	const meta: Record<string, unknown> = {
		reportId: opts.reportId,
		generatedAt: opts.generatedAt
	};

	if (isLegacyReportData(data)) {
		return buildLegacyReportView(data as unknown as LegacyReportData, meta);
	}

	return buildModernReportView(data, meta);
}

function buildModernReportView(data: ReportData, meta: Record<string, unknown>): ViewModel {
	const blocks: Block[] = [];
	const sections = data.sections;
	const charts = data.charts;

	meta.periodStart = data.reportMetadata?.periodStart;
	meta.periodEnd = data.reportMetadata?.periodEnd;
	meta.sourcesCount = data.reportMetadata?.sourcesCount;
	meta.articleCount = data.reportMetadata?.articleCount;

	if (!sections) {
		return view(
			REPORT_VIEW_ID,
			[emptyState('No sections', 'This report is missing its rendered sections.')],
			{ title: 'Market Analysis Report', meta }
		);
	}

	if (sections.executiveSummary?.text) {
		blocks.push(
			section('Executive Summary', [markdown(sections.executiveSummary.text)], {
				id: 'executive-summary'
			})
		);
	}

	if (sections.marketSnapshot?.text) {
		const pie = buildKeywordDistributionChart(charts);
		const marketBlocks: Block[] = [];
		if (pie) marketBlocks.push(pie);
		marketBlocks.push(markdown(sections.marketSnapshot.text));
		blocks.push(section('Market Snapshot', marketBlocks, { id: 'market-snapshot' }));
	}

	if (sections.developerSignals?.text) {
		blocks.push(
			section('Developer Signals', [markdown(sections.developerSignals.text)], {
				id: 'developer-signals'
			})
		);
	}

	const line = buildEntityCentralityChart(charts);
	if (line) {
		blocks.push(section(undefined, [line], { id: 'centrality' }));
	}

	if (sections.signalInterpretation) {
		const interp = sections.signalInterpretation;
		const interpBlocks: Block[] = [];
		if (interp.text) interpBlocks.push(markdown(interp.text));
		if (interp.narrative && interp.narrative.length > 0) {
			interpBlocks.push(markdown(interp.narrative.join('\n\n')));
		} else if (interp.interpretations && interp.interpretations.length > 0) {
			for (const it of interp.interpretations) {
				interpBlocks.push(buildInterpretationBlock(it));
			}
		}
		blocks.push(section('Signal Interpretation', interpBlocks, { id: 'signal-interpretation' }));
	}

	if (sections.supportingResources?.resources?.length) {
		blocks.push(
			section(
				'Supporting Resources',
				[list(sections.supportingResources.resources.map(resourceToListItem), 'numbered')],
				{ id: 'supporting-resources' }
			)
		);
	}

	return view(REPORT_VIEW_ID, blocks, { title: 'Market Analysis Report', meta });
}

function buildLegacyReportView(data: LegacyReportData, meta: Record<string, unknown>): ViewModel {
	const blocks: Block[] = [];
	const sections = data.sections as Record<string, { text?: string }>;

	const titles: Array<{ key: string; title: string }> = [
		{ key: 'executiveSummary', title: 'Executive Summary' },
		{ key: 'marketLandscape', title: 'Market Landscape' },
		{ key: 'technologyTrends', title: 'Technology Trends' },
		{ key: 'developerSignals', title: 'Developer Signals' },
		{ key: 'contentRecommendations', title: 'Content Recommendations' }
	];

	for (const { key, title } of titles) {
		const sec = sections[key];
		if (sec?.text) {
			blocks.push(section(title, [markdown(sec.text)], { id: `legacy-${key}` }));
		}
	}

	meta.legacy = true;

	return view(REPORT_VIEW_ID, blocks, { title: 'Market Analysis Report', meta });
}

function buildKeywordDistributionChart(charts: ReportData['charts']): ChartBlock | null {
	const buckets = charts?.keywordDistribution?.buckets ?? [];
	if (buckets.length === 0) return null;

	const named = buckets.filter((b) => b.keyword.toLowerCase() !== 'other');
	if (named.length === 0) return null;

	return chart(
		'pie',
		[
			{
				name: 'keywords',
				points: named.map((b) => ({ x: b.keyword, y: b.count, label: `${b.pct}%` }))
			}
		],
		{ title: 'Keyword distribution', height: 320 }
	);
}

function buildEntityCentralityChart(charts: ReportData['charts']): ChartBlock | null {
	const ec = charts?.entityCentrality;
	if (!ec || ec.series.length === 0) return null;

	const series: ChartSeries[] = ec.series.map((s) => ({
		name: s.entityName,
		points: s.points.map((p) => ({ x: p.period, y: p.centrality }))
	}));

	return chart('line', series, {
		title: 'Entity centrality over time',
		xAxis: { label: 'Period', type: 'category' },
		yAxis: { label: 'Centrality' },
		height: 240
	});
}

function buildInterpretationBlock(interp: SignalInterpretation): Block {
	return list(
		[
			{ primary: 'Signal', secondary: interp.signal },
			{ primary: 'Meaning', secondary: interp.meaning },
			{ primary: 'Implication', secondary: interp.implication }
		],
		'plain'
	);
}

function resourceToListItem(r: SupportingResource): ListItem {
	return {
		primary: r.title,
		secondary: r.why,
		href: r.url
	};
}
