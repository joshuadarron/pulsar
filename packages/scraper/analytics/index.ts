export {
	compute12MonthDelta,
	computeMultiYearTrajectory,
	computeYoYDelta,
	type Period
} from './deltas.js';

export {
	buildPeriodWindows,
	fetchEntityHistory,
	periodBounds,
	periodLabel,
	type EntityHistory,
	type EntityHistoryQuery,
	type HistoryDeps,
	type Neo4jLike,
	type PeriodKind,
	type PgLike
} from './historical-centrality.js';

export { enrichEntitiesWithHistory } from './enrich.js';
