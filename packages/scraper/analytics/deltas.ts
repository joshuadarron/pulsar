import type { Trajectory } from '@pulsar/shared/types';

/**
 * A closed time window. Both ends are inclusive at the resolution of the
 * caller (the analytics layer here uses month or year buckets).
 */
export type Period = { start: Date; end: Date };

/**
 * Percent change between the current period and the period 12 months prior.
 * Returned as a fraction (0.5 means +50 percent, -0.25 means -25 percent).
 *
 * Returns 0 when the prior-period count is 0 to avoid division by zero. This
 * is the documented sparse-data behavior: callers should not interpret 0 as
 * "no change" without inspecting whether prior data exists.
 *
 * @param currentMentions Mentions in the current period.
 * @param twelveMonthsAgoMentions Mentions in the same-length period 12 months earlier.
 * @return Fractional delta (e.g. 0.5 for +50%).
 */
export function compute12MonthDelta(
	currentMentions: number,
	twelveMonthsAgoMentions: number
): number {
	if (twelveMonthsAgoMentions <= 0) return 0;
	return (currentMentions - twelveMonthsAgoMentions) / twelveMonthsAgoMentions;
}

/**
 * Percent change between the current calendar year's mentions and the prior
 * calendar year's mentions.
 *
 * Returns 0 when the prior-year count is 0 to avoid division by zero.
 *
 * @param currentYearMentions Mentions accumulated in the current year window.
 * @param previousYearMentions Mentions accumulated in the prior year window.
 * @return Fractional delta (e.g. -0.1 for -10%).
 */
export function computeYoYDelta(currentYearMentions: number, previousYearMentions: number): number {
	if (previousYearMentions <= 0) return 0;
	return (currentYearMentions - previousYearMentions) / previousYearMentions;
}

/**
 * Multi-year trajectory for an entity, suitable for embedding in a prompt or
 * a sparkline. Periods present in `yearlyMentions` define the trajectory; the
 * centrality map is consulted per period and falls back to 0 when missing.
 *
 * Returned periods are sorted ascending by label.
 *
 * @param _entityName Entity name (kept for symmetry with the API; the function is pure).
 * @param yearlyMentions Map of period label ("YYYY" or "YYYY-MM") to mention count.
 * @param yearlyCentrality Map of period label to centrality score (pagerank).
 * @return Trajectory entries, one per period found in `yearlyMentions`.
 *
 * @example
 *   computeMultiYearTrajectory('agents', { '2023': 12, '2024': 48 }, { '2024': 0.41 })
 *   // [{ period: '2023', mentions: 12, centrality: 0 }, { period: '2024', mentions: 48, centrality: 0.41 }]
 */
export function computeMultiYearTrajectory(
	_entityName: string,
	yearlyMentions: Record<string, number>,
	yearlyCentrality: Record<string, number>
): Trajectory {
	const periods = Object.keys(yearlyMentions).sort();
	return periods.map((period) => ({
		period,
		mentions: yearlyMentions[period] ?? 0,
		centrality: yearlyCentrality[period] ?? 0
	}));
}
