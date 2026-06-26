import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ReportData } from '@pulsar/shared/types';
import type { Block, ChartBlock, ListBlock, SectionBlock } from '@pulsar/view-model';

import { REPORT_VIEW_ID, buildReportView } from '../reportView.js';

function buildNewReport(): ReportData {
	return {
		reportMetadata: {
			periodStart: '2026-04-01T00:00:00Z',
			periodEnd: '2026-04-30T00:00:00Z',
			sourcesCount: 12,
			articleCount: 480
		},
		sections: {
			executiveSummary: {
				text: 'Executive summary paragraph one.\n\nSecond paragraph.'
			},
			marketSnapshot: {
				text: 'Market Snapshot paragraph one.\n\nSecond paragraph.'
			},
			developerSignals: {
				text: 'Developer signals first paragraph.\n\nSecond paragraph.'
			},
			signalInterpretation: {
				text: 'Signal interpretation intro paragraph.',
				interpretations: [
					{
						signal: 'MCP usage doubled in 30 days',
						meaning: 'The connective layer is gaining adoption',
						implication: 'Position your platform around MCP integrations'
					},
					{
						signal: 'Agent frameworks fragmented',
						meaning: 'Consolidation has not arrived yet',
						implication: 'Win on developer ergonomics'
					},
					{
						signal: 'RAG mentions plateaued',
						meaning: 'Plain RAG is now baseline',
						implication: 'Lead with retrieval quality'
					}
				]
			},
			supportingResources: {
				resources: [
					{
						url: 'https://example.com/mcp',
						title: 'MCP specification',
						why: 'Defines the wire format used across integrations'
					},
					{
						url: 'https://example.com/agents',
						title: 'Agent framework comparison',
						why: 'Side-by-side analysis'
					}
				]
			}
		},
		charts: {
			keywordDistribution: {
				windowStart: '2026-04-01T00:00:00Z',
				windowEnd: '2026-04-30T00:00:00Z',
				totalArticles: 480,
				buckets: [
					{ keyword: 'rag', count: 60, pct: 30 },
					{ keyword: 'agents', count: 50, pct: 25 },
					{ keyword: 'mcp', count: 40, pct: 20 },
					{ keyword: 'Other', count: 50, pct: 25 }
				]
			},
			entityCentrality: {
				currentPeriodEnd: '2026-04-30T00:00:00Z',
				periodKind: 'month',
				sparse: false,
				series: [
					{
						entityName: 'Claude',
						points: [
							{ period: '2026-02', centrality: 0.4, mentions: 50 },
							{ period: '2026-03', centrality: 0.55, mentions: 70 },
							{ period: '2026-04', centrality: 0.62, mentions: 90 }
						]
					}
				]
			}
		}
	};
}

function buildLegacyReport(): ReportData {
	return {
		sections: {
			executiveSummary: { text: 'Legacy executive summary text.' },
			marketLandscape: { text: 'Legacy market landscape paragraph.' },
			technologyTrends: { text: 'Legacy technology trends paragraph.' },
			developerSignals: { text: 'Legacy developer signals paragraph.' },
			contentRecommendations: { text: 'Legacy content recommendations text.' }
		}
	} as unknown as ReportData;
}

function sectionTitles(blocks: Block[]): string[] {
	return blocks.filter((b): b is SectionBlock => b.kind === 'section').map((s) => s.title ?? '');
}

describe('buildReportView (Phase 4+ new shape)', () => {
	it('returns a view-model with the canonical view id and title', () => {
		const vm = buildReportView(buildNewReport(), { reportId: 'r1', generatedAt: 'now' });
		assert.equal(vm.view, REPORT_VIEW_ID);
		assert.equal(vm.title, 'Market Analysis Report');
		assert.equal(vm.schemaVersion, '1');
	});

	it('renders the five canonical sections in order', () => {
		const vm = buildReportView(buildNewReport(), { reportId: 'r1' });
		const titles = sectionTitles(vm.blocks);
		assert.deepEqual(titles, [
			'Executive Summary',
			'Market Snapshot',
			'Developer Signals',
			'',
			'Signal Interpretation',
			'Supporting Resources'
		]);
	});

	it('embeds the keyword distribution pie inside Market Snapshot', () => {
		const vm = buildReportView(buildNewReport(), { reportId: 'r1' });
		const marketSection = vm.blocks
			.filter((b): b is SectionBlock => b.kind === 'section')
			.find((s) => s.title === 'Market Snapshot');
		assert.ok(marketSection);
		const pie = marketSection.blocks.find(
			(b): b is ChartBlock => b.kind === 'chart' && b.chartKind === 'pie'
		);
		assert.ok(pie, 'pie chart should be present');
		assert.equal(pie.series[0]?.points.length, 3, 'Other bucket should be dropped');
	});

	it('places the entity centrality line chart between Developer Signals and Signal Interpretation', () => {
		const vm = buildReportView(buildNewReport(), { reportId: 'r1' });
		const titles = sectionTitles(vm.blocks);
		const devIdx = titles.indexOf('Developer Signals');
		const interpIdx = titles.indexOf('Signal Interpretation');
		const chartIdx = vm.blocks.findIndex(
			(b) =>
				b.kind === 'section' &&
				b.id === 'centrality' &&
				b.blocks.some((bb) => bb.kind === 'chart' && bb.chartKind === 'line')
		);
		assert.ok(devIdx > -1 && interpIdx > -1 && chartIdx > -1);
		assert.ok(chartIdx > devIdx, 'line chart follows Developer Signals');
		assert.ok(chartIdx < interpIdx, 'line chart precedes Signal Interpretation');
	});

	it('renders three interpretation list blocks with Signal/Meaning/Implication rows', () => {
		const vm = buildReportView(buildNewReport(), { reportId: 'r1' });
		const interpSection = vm.blocks
			.filter((b): b is SectionBlock => b.kind === 'section')
			.find((s) => s.title === 'Signal Interpretation');
		assert.ok(interpSection);
		const lists = interpSection.blocks.filter((b): b is ListBlock => b.kind === 'list');
		assert.equal(lists.length, 3);
		for (const lst of lists) {
			assert.deepEqual(
				lst.items.map((i) => i.primary),
				['Signal', 'Meaning', 'Implication']
			);
		}
	});

	it('renders supporting resources as a numbered list of links', () => {
		const vm = buildReportView(buildNewReport(), { reportId: 'r1' });
		const resSection = vm.blocks
			.filter((b): b is SectionBlock => b.kind === 'section')
			.find((s) => s.title === 'Supporting Resources');
		assert.ok(resSection);
		const lst = resSection.blocks[0];
		assert.equal(lst.kind, 'list');
		const listBlock = lst as ListBlock;
		assert.equal(listBlock.variant, 'numbered');
		assert.equal(listBlock.items[0]?.href, 'https://example.com/mcp');
		assert.equal(listBlock.items[0]?.primary, 'MCP specification');
	});

	it('exposes report metadata on the view model', () => {
		const vm = buildReportView(buildNewReport(), {
			reportId: 'r1',
			generatedAt: '2026-04-30'
		});
		assert.equal(vm.meta?.reportId, 'r1');
		assert.equal(vm.meta?.generatedAt, '2026-04-30');
		assert.equal(vm.meta?.articleCount, 480);
	});
});

describe('buildReportView (legacy shape)', () => {
	it('marks the view-model as legacy when sections.marketLandscape is present', () => {
		const vm = buildReportView(buildLegacyReport(), { reportId: 'r2' });
		assert.equal(vm.meta?.legacy, true);
	});

	it('renders the legacy section titles', () => {
		const vm = buildReportView(buildLegacyReport(), { reportId: 'r2' });
		const titles = sectionTitles(vm.blocks);
		assert.deepEqual(titles, [
			'Executive Summary',
			'Market Landscape',
			'Technology Trends',
			'Developer Signals',
			'Content Recommendations'
		]);
	});

	it('does not render Phase 4 section titles for legacy reports', () => {
		const vm = buildReportView(buildLegacyReport(), { reportId: 'r2' });
		const titles = sectionTitles(vm.blocks);
		assert.ok(!titles.includes('Market Snapshot'));
		assert.ok(!titles.includes('Signal Interpretation'));
		assert.ok(!titles.includes('Supporting Resources'));
	});
});

describe('buildReportView (edge cases)', () => {
	it('returns an empty-state block when sections are missing', () => {
		const data = {
			reportMetadata: undefined,
			sections: undefined,
			charts: undefined
		} as unknown as ReportData;
		const vm = buildReportView(data, { reportId: 'r3' });
		assert.equal(vm.blocks.length, 1);
		assert.equal(vm.blocks[0].kind, 'emptyState');
	});

	it('omits the pie chart when only an Other bucket is present', () => {
		const data = buildNewReport();
		data.charts.keywordDistribution.buckets = [{ keyword: 'Other', count: 100, pct: 100 }];
		const vm = buildReportView(data, { reportId: 'r4' });
		const marketSection = vm.blocks
			.filter((b): b is SectionBlock => b.kind === 'section')
			.find((s) => s.title === 'Market Snapshot');
		assert.ok(marketSection);
		const hasPie = marketSection.blocks.some((b) => b.kind === 'chart');
		assert.equal(hasPie, false);
	});

	it('omits the centrality section when the series is empty', () => {
		const data = buildNewReport();
		data.charts.entityCentrality.series = [];
		const vm = buildReportView(data, { reportId: 'r5' });
		const hasCentralitySection = vm.blocks.some(
			(b) => b.kind === 'section' && b.id === 'centrality'
		);
		assert.equal(hasCentralitySection, false);
	});

	it('prefers narrative paragraphs over interpretation cards when both are present', () => {
		const data = buildNewReport();
		data.sections.signalInterpretation.narrative = ['Narrative paragraph one.', 'Narrative two.'];
		const vm = buildReportView(data, { reportId: 'r6' });
		const interpSection = vm.blocks
			.filter((b): b is SectionBlock => b.kind === 'section')
			.find((s) => s.title === 'Signal Interpretation');
		assert.ok(interpSection);
		const hasLists = interpSection.blocks.some((b) => b.kind === 'list');
		const hasMarkdown = interpSection.blocks.filter((b) => b.kind === 'markdown').length === 2;
		assert.equal(hasLists, false, 'interpretation cards skipped when narrative present');
		assert.equal(hasMarkdown, true, 'two markdown blocks: intro text + joined narrative');
	});
});
