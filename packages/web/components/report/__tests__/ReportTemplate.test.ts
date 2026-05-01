import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ReportData } from '@pulsar/shared/types';

// Stub PulsarLogo to avoid the JSX classic-runtime React-not-in-scope issue
// when importing through the JSX-preserve web tsconfig. The header component
// is incidental to the section structure being asserted here.
mock.module('../../PulsarLogo', {
	defaultExport: () => null
});

const { default: ReportTemplate } = await import('../ReportTemplate');

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
				text: 'Executive summary paragraph one. Sentence two highlighting the headline.\n\nSecond paragraph.'
			},
			marketSnapshot: {
				text: 'Market Snapshot paragraph one wrapping around the pie chart aside.\n\nSecond paragraph.'
			},
			developerSignals: {
				text: 'Developer signals first paragraph.\n\nSecond developer signals paragraph.'
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
						signal: 'Agent frameworks fragmented across 8 ecosystems',
						meaning: 'Consolidation has not arrived yet',
						implication: 'Win on developer ergonomics, not framework lock-in'
					},
					{
						signal: 'RAG mentions plateaued',
						meaning: 'Plain RAG is now a baseline expectation',
						implication: 'Lead with retrieval quality, not the technique'
					}
				]
			},
			supportingResources: {
				resources: [
					{
						url: 'https://example.com/mcp',
						title: 'MCP specification',
						why: 'Defines the wire format used across all integrations'
					},
					{
						url: 'https://example.com/agents',
						title: 'Agent framework comparison',
						why: 'Side-by-side ergonomics analysis across major frameworks'
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
					},
					{
						entityName: 'GPT',
						points: [
							{ period: '2026-02', centrality: 0.45, mentions: 60 },
							{ period: '2026-03', centrality: 0.5, mentions: 65 },
							{ period: '2026-04', centrality: 0.5, mentions: 65 }
						]
					}
				]
			}
		}
	};
}

function buildLegacyReport(): unknown {
	return {
		reportMetadata: {
			periodStart: '2025-09-01T00:00:00Z',
			periodEnd: '2025-09-30T00:00:00Z',
			sourcesCount: 10,
			articleCount: 250
		},
		sections: {
			executiveSummary: {
				text: 'Legacy executive summary text.'
			},
			marketLandscape: {
				text: 'Legacy market landscape paragraph.',
				data: {
					entities: [
						{ name: 'Claude', type: 'model', mentionCount: 120 },
						{ name: 'GPT', type: 'model', mentionCount: 90 }
					],
					technologies: [
						{ name: 'RAG', type: 'concept', mentionCount: 80 },
						{ name: 'MCP', type: 'tool', mentionCount: 60 },
						{ name: 'LangChain', type: 'tool', mentionCount: 40 }
					],
					sourceDistribution: [
						{ source: 'hackernews', articleCount: 60 },
						{ source: 'reddit', articleCount: 40 }
					]
				}
			},
			technologyTrends: {
				text: 'Legacy technology trends paragraph.',
				data: {
					keywords: [{ keyword: 'rag', count7d: 30, count30d: 90, delta: 5 }],
					topics: [],
					emergingTopics: ['agentic-coding']
				}
			},
			developerSignals: {
				text: 'Legacy developer signals paragraph.',
				data: {
					sentimentBreakdown: { positive: 50, negative: 20, neutral: 30 }
				}
			},
			contentRecommendations: {
				text: 'Legacy content recommendations text.'
			}
		}
	};
}

function render(data: ReportData, variant: 'ui' | 'email'): string {
	return renderToStaticMarkup(createElement(ReportTemplate, { data, variant, reportId: 'test-1' }));
}

describe('ReportTemplate (Phase 4 dispatcher)', () => {
	describe('new-shape report', () => {
		it('renders the new section titles in the UI variant', () => {
			const html = render(buildNewReport(), 'ui');
			assert.match(html, /Executive Summary/);
			assert.match(html, /Market Snapshot/);
			assert.match(html, /Developer Signals/);
			assert.match(html, /Signal Interpretation/);
			assert.match(html, /Supporting Resources/);
		});

		it('does not render legacy section titles for new reports', () => {
			const html = render(buildNewReport(), 'ui');
			assert.doesNotMatch(html, /Market Landscape/);
			assert.doesNotMatch(html, /Technology Trends/);
			assert.doesNotMatch(html, /Content Recommendations/);
			assert.doesNotMatch(html, /Data Sources/);
		});

		it('embeds the keyword distribution pie SVG inside Market Snapshot', () => {
			const html = render(buildNewReport(), 'ui');
			assert.match(html, /aria-label="Keyword distribution pie chart"/);
		});

		it('embeds the centrality line SVG between Developer Signals and Signal Interpretation', () => {
			const html = render(buildNewReport(), 'ui');
			const centIdx = html.indexOf('Entity centrality over time');
			const signalIdx = html.indexOf('Signal Interpretation');
			const devIdx = html.indexOf('Developer Signals');
			assert.ok(centIdx > -1, 'line chart svg should be present');
			assert.ok(devIdx > -1 && devIdx < centIdx, 'line chart should follow Developer Signals');
			assert.ok(centIdx < signalIdx, 'line chart should precede Signal Interpretation');
		});

		it('renders Signal/Meaning/Implication labels for each interpretation card', () => {
			const html = render(buildNewReport(), 'ui');
			const signals = html.match(/Signal:/g) ?? [];
			const meanings = html.match(/Meaning:/g) ?? [];
			const implications = html.match(/Implication:/g) ?? [];
			assert.equal(signals.length, 3);
			assert.equal(meanings.length, 3);
			assert.equal(implications.length, 3);
		});

		it('renders supporting resources as anchor tags with titles', () => {
			const html = render(buildNewReport(), 'ui');
			assert.match(html, /href="https:\/\/example\.com\/mcp"/);
			assert.match(html, /MCP specification/);
		});

		it('email variant produces inline-styled HTML', () => {
			const html = render(buildNewReport(), 'email');
			assert.match(html, /Executive Summary/);
			assert.match(html, /Signal Interpretation/);
			assert.match(html, /float:left/);
		});

		it('renders sparse footnote when entity centrality is sparse', () => {
			const data = buildNewReport();
			data.charts.entityCentrality.sparse = true;
			data.charts.entityCentrality.series = data.charts.entityCentrality.series.map((s) => ({
				...s,
				points: s.points.slice(0, 1)
			}));
			const html = render(data, 'ui');
			assert.match(html, /Limited to current ingestion window/);
		});
	});

	describe('legacy-shape report', () => {
		it('delegates to the legacy template when sections.marketLandscape is present', () => {
			const html = render(buildLegacyReport() as ReportData, 'ui');
			assert.match(html, /Market Landscape/);
			assert.match(html, /Technology Trends/);
			assert.match(html, /Content Recommendations/);
		});

		it('does not render new-shape labels for legacy reports', () => {
			const html = render(buildLegacyReport() as ReportData, 'ui');
			assert.doesNotMatch(html, /Market Snapshot/);
			assert.doesNotMatch(html, /Signal Interpretation/);
			assert.doesNotMatch(html, /Supporting Resources/);
		});
	});
});
