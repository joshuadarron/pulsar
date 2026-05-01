import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type PieSlice, renderPieSvg } from '../pie-svg.js';

describe('renderPieSvg', () => {
	describe('empty input', () => {
		it('returns an empty-state SVG when slices is empty', () => {
			const svg = renderPieSvg([]);
			assert.match(svg, /<svg/);
			assert.match(svg, /No data/);
		});

		it('returns an empty-state SVG when all values are zero', () => {
			const svg = renderPieSvg([
				{ label: 'rag', value: 0, pct: 0 },
				{ label: 'agents', value: 0, pct: 0 }
			]);
			assert.match(svg, /No data/);
		});
	});

	describe('happy path', () => {
		it('renders a single full slice for one input slice', () => {
			const svg = renderPieSvg([{ label: 'rag', value: 100, pct: 100 }]);
			assert.match(svg, /<path /);
			assert.match(svg, /rag/);
			assert.match(svg, /100%/);
		});

		it('renders ten labelled slices plus an Other bucket', () => {
			const slices: PieSlice[] = Array.from({ length: 10 }, (_, i) => ({
				label: `kw${i}`,
				value: 5,
				pct: 5
			}));
			slices.push({ label: 'Other', value: 50, pct: 50 });

			const svg = renderPieSvg(slices);
			const pathCount = (svg.match(/<path /g) ?? []).length;
			assert.equal(pathCount, 11);
			assert.match(svg, /Other/);
		});

		it('uses the grey color for Other regardless of position', () => {
			const slices: PieSlice[] = [
				{ label: 'Other', value: 60, pct: 60 },
				{ label: 'rag', value: 40, pct: 40 }
			];
			const svg = renderPieSvg(slices);
			// Other gets the grey #9ca3af fill.
			assert.match(svg, /fill="#9ca3af"/);
		});

		it('handles legendPosition right (default) and below', () => {
			const slices: PieSlice[] = [
				{ label: 'rag', value: 60, pct: 60 },
				{ label: 'agents', value: 40, pct: 40 }
			];
			const right = renderPieSvg(slices);
			const below = renderPieSvg(slices, { legendPosition: 'below' });
			// Below moves the legend group below the chart, so the legend transform y offset is larger.
			const rightMatch = right.match(/<g transform="translate\(\d+, (\d+)\)"/g);
			const belowMatch = below.match(/<g transform="translate\(8, (\d+)\)"/);
			assert.ok(rightMatch && rightMatch.length > 0);
			assert.ok(belowMatch);
		});

		it('omits the legend when showLegend is false', () => {
			const slices: PieSlice[] = [{ label: 'rag', value: 100, pct: 100 }];
			const svg = renderPieSvg(slices, { showLegend: false });
			assert.doesNotMatch(svg, /rag \(/);
		});
	});

	describe('percentage labels', () => {
		it('renders rounded percentages for slices and respects pct sum', () => {
			const slices: PieSlice[] = [
				{ label: 'a', value: 50, pct: 50 },
				{ label: 'b', value: 30, pct: 30 },
				{ label: 'c', value: 20, pct: 20 }
			];
			const sum = slices.reduce((acc, s) => acc + s.pct, 0);
			assert.equal(sum, 100);

			const svg = renderPieSvg(slices);
			assert.match(svg, /50%/);
			assert.match(svg, /30%/);
			assert.match(svg, /20%/);
		});
	});

	describe('escaping', () => {
		it('escapes XML-unsafe characters in labels', () => {
			const slices: PieSlice[] = [{ label: '<script>', value: 100, pct: 100 }];
			const svg = renderPieSvg(slices);
			assert.match(svg, /&lt;script&gt;/);
			assert.doesNotMatch(svg, /<script>/);
		});
	});
});
