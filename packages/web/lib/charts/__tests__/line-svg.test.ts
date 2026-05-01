import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type LineSeries, SPARSE_FOOTNOTE, renderLineSvg } from '../line-svg.js';

describe('renderLineSvg', () => {
	describe('empty input', () => {
		it('renders an empty state when no series are provided', () => {
			const svg = renderLineSvg([]);
			assert.match(svg, /No historical data yet/);
		});

		it('renders an empty state when every series has zero points', () => {
			const svg = renderLineSvg([
				{ name: 'rag', points: [] },
				{ name: 'agents', points: [] }
			]);
			assert.match(svg, /No historical data yet/);
		});

		it('renders the sparse footnote when every series has a single point', () => {
			const series: LineSeries[] = [
				{ name: 'rag', points: [{ x: '2025-01', y: 12 }] },
				{ name: 'agents', points: [{ x: '2025-01', y: 7 }] }
			];
			const svg = renderLineSvg(series);
			assert.match(svg, new RegExp(SPARSE_FOOTNOTE.slice(0, 30)));
		});

		it('renders a custom emptyMessage when supplied', () => {
			const svg = renderLineSvg([], { emptyMessage: 'Backfill running' });
			assert.match(svg, /Backfill running/);
		});
	});

	describe('happy path', () => {
		it('renders multiple series with multiple points each', () => {
			const series: LineSeries[] = [
				{
					name: 'rag',
					points: [
						{ x: '2025-01', y: 10 },
						{ x: '2025-02', y: 20 },
						{ x: '2025-03', y: 35 }
					]
				},
				{
					name: 'agents',
					points: [
						{ x: '2025-01', y: 5 },
						{ x: '2025-02', y: 8 },
						{ x: '2025-03', y: 12 }
					]
				}
			];
			const svg = renderLineSvg(series);
			const pathCount = (svg.match(/<path /g) ?? []).length;
			assert.equal(pathCount, 2);
			assert.match(svg, /rag/);
			assert.match(svg, /agents/);
		});

		it('assigns distinct colors when none are provided', () => {
			const series: LineSeries[] = [
				{
					name: 'a',
					points: [
						{ x: '1', y: 1 },
						{ x: '2', y: 2 }
					]
				},
				{
					name: 'b',
					points: [
						{ x: '1', y: 3 },
						{ x: '2', y: 4 }
					]
				}
			];
			const svg = renderLineSvg(series);
			const colors = [...svg.matchAll(/<path[^>]+stroke="(#[0-9a-fA-F]+)"/g)].map((m) => m[1]);
			assert.equal(colors.length, 2);
			assert.notEqual(colors[0], colors[1]);
		});

		it('respects an explicit color override on a series', () => {
			const series: LineSeries[] = [
				{
					name: 'a',
					color: '#123456',
					points: [
						{ x: '1', y: 1 },
						{ x: '2', y: 2 }
					]
				}
			];
			const svg = renderLineSvg(series);
			assert.match(svg, /stroke="#123456"/);
		});

		it('renders axis labels when provided', () => {
			const series: LineSeries[] = [
				{
					name: 'a',
					points: [
						{ x: '1', y: 1 },
						{ x: '2', y: 2 }
					]
				}
			];
			const svg = renderLineSvg(series, { yAxisLabel: 'Centrality', xAxisLabel: 'Period' });
			assert.match(svg, /Centrality/);
			assert.match(svg, /Period/);
		});
	});

	describe('escaping', () => {
		it('escapes XML-unsafe series names', () => {
			const series: LineSeries[] = [
				{
					name: '<bad>',
					points: [
						{ x: '1', y: 1 },
						{ x: '2', y: 2 }
					]
				}
			];
			const svg = renderLineSvg(series);
			assert.match(svg, /&lt;bad&gt;/);
		});
	});
});
