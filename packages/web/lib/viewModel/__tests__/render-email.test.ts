import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ReportData } from '@pulsar/shared/types';
import { buildReportView } from '@pulsar/app-market-analysis/views/reportView';

import { renderViewModelEmail } from '../render-email.js';

function buildNewReport(): ReportData {
	return {
		reportMetadata: {
			periodStart: '2026-04-01T00:00:00Z',
			periodEnd: '2026-04-30T00:00:00Z',
			sourcesCount: 12,
			articleCount: 480
		},
		sections: {
			executiveSummary: { text: 'Executive summary paragraph one.\n\nSecond paragraph.' },
			marketSnapshot: { text: 'Market snapshot paragraph one.\n\nSecond paragraph.' },
			developerSignals: { text: 'Developer signals first paragraph.\n\nSecond paragraph.' },
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

function renderReport(): string {
	const vm = buildReportView(buildNewReport(), { reportId: 'test-1' });
	return renderViewModelEmail(vm);
}

describe('renderViewModelEmail (Phase 4+ report parity)', () => {
	it('contains the five canonical section titles', () => {
		const html = renderReport();
		assert.match(html, /Executive Summary/);
		assert.match(html, /Market Snapshot/);
		assert.match(html, /Developer Signals/);
		assert.match(html, /Signal Interpretation/);
		assert.match(html, /Supporting Resources/);
	});

	it('does not include legacy section titles', () => {
		const html = renderReport();
		assert.doesNotMatch(html, /Market Landscape/);
		assert.doesNotMatch(html, /Technology Trends/);
		assert.doesNotMatch(html, /Content Recommendations/);
	});

	it('embeds the pie chart SVG', () => {
		const html = renderReport();
		assert.match(html, /aria-label="Keyword distribution pie chart"/);
	});

	it('embeds the centrality line chart between Developer Signals and Signal Interpretation', () => {
		const html = renderReport();
		const devIdx = html.indexOf('Developer Signals');
		const lineIdx = html.indexOf('Entity centrality over time');
		const interpIdx = html.indexOf('Signal Interpretation');
		assert.ok(devIdx > -1 && lineIdx > -1 && interpIdx > -1);
		assert.ok(devIdx < lineIdx);
		assert.ok(lineIdx < interpIdx);
	});

	it('renders each interpretation row as Signal/Meaning/Implication labels', () => {
		const html = renderReport();
		assert.equal((html.match(/Signal</g) ?? []).length, 3);
		assert.equal((html.match(/Meaning</g) ?? []).length, 3);
		assert.equal((html.match(/Implication</g) ?? []).length, 3);
	});

	it('renders supporting resources as a numbered list with links', () => {
		const html = renderReport();
		assert.match(html, /<ol[^>]*style="[^"]*list-style:decimal/);
		assert.match(html, /href="https:\/\/example\.com\/mcp"/);
		assert.match(html, />MCP specification</);
	});

	it('outputs inline-styled HTML with no Tailwind class attributes', () => {
		const html = renderReport();
		assert.doesNotMatch(html, /class="[^"]*tw-/);
		assert.doesNotMatch(html, /className=/);
		assert.match(html, /style="/);
	});

	it('wraps content in an HTML document when document=true', () => {
		const vm = buildReportView(buildNewReport(), { reportId: 'test-1' });
		const html = renderViewModelEmail(vm, { document: true });
		assert.match(html, /^<!DOCTYPE html>/);
		assert.match(html, /<\/html>/);
	});

	it('passes through caller-provided header and footer chrome', () => {
		const vm = buildReportView(buildNewReport(), { reportId: 'test-1' });
		const html = renderViewModelEmail(vm, {
			header: '<div id="cta-header">Top</div>',
			footer: '<div id="cta-footer">Bottom</div>'
		});
		assert.match(html, /id="cta-header"/);
		assert.match(html, /id="cta-footer"/);
		assert.ok(html.indexOf('cta-header') < html.indexOf('Executive Summary'));
		assert.ok(html.indexOf('cta-footer') > html.indexOf('Supporting Resources'));
	});
});
