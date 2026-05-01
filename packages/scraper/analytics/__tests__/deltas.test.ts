import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compute12MonthDelta, computeMultiYearTrajectory, computeYoYDelta } from '../deltas.js';

describe('compute12MonthDelta', () => {
	describe('happy path', () => {
		it('returns the fractional change between current and prior period', () => {
			assert.equal(compute12MonthDelta(150, 100), 0.5);
			assert.equal(compute12MonthDelta(50, 100), -0.5);
		});
	});

	describe('sparse data', () => {
		it('returns 0 when prior is 0 (avoids division by zero)', () => {
			assert.equal(compute12MonthDelta(42, 0), 0);
		});

		it('returns 0 when prior is negative (treated as missing)', () => {
			assert.equal(compute12MonthDelta(42, -1), 0);
		});

		it('returns 0 when both periods are 0', () => {
			assert.equal(compute12MonthDelta(0, 0), 0);
		});
	});
});

describe('computeYoYDelta', () => {
	describe('happy path', () => {
		it('returns positive fraction when current year exceeds prior', () => {
			assert.equal(computeYoYDelta(200, 100), 1);
		});

		it('returns negative fraction when current year is below prior', () => {
			assert.equal(computeYoYDelta(75, 100), -0.25);
		});
	});

	describe('sparse data', () => {
		it('returns 0 when prior year is 0', () => {
			assert.equal(computeYoYDelta(60, 0), 0);
		});
	});
});

describe('computeMultiYearTrajectory', () => {
	describe('happy path', () => {
		it('returns one entry per period sorted ascending by label', () => {
			const out = computeMultiYearTrajectory(
				'agents',
				{ '2024': 50, '2023': 20, '2022': 5 },
				{ '2024': 0.4, '2023': 0.1, '2022': 0.02 }
			);
			assert.deepEqual(out, [
				{ period: '2022', mentions: 5, centrality: 0.02 },
				{ period: '2023', mentions: 20, centrality: 0.1 },
				{ period: '2024', mentions: 50, centrality: 0.4 }
			]);
		});

		it('falls back to centrality 0 when a period is missing from the centrality map', () => {
			const out = computeMultiYearTrajectory('mcp', { '2023': 10, '2024': 25 }, { '2024': 0.3 });
			assert.deepEqual(out, [
				{ period: '2023', mentions: 10, centrality: 0 },
				{ period: '2024', mentions: 25, centrality: 0.3 }
			]);
		});
	});

	describe('sparse data', () => {
		it('returns just the current period when only one period is given', () => {
			const out = computeMultiYearTrajectory('rust', { '2024': 12 }, { '2024': 0.05 });
			assert.equal(out.length, 1);
			assert.equal(out[0].period, '2024');
		});

		it('returns an empty array when no periods are given', () => {
			const out = computeMultiYearTrajectory('vapor', {}, {});
			assert.deepEqual(out, []);
		});
	});
});
