// Single import surface for any app that needs to construct LLM context.
// Apps consume `buildContext({ slices })` or the `buildReportContext(reportId)`
// shorthand; the underlying intelligence/ and product/ modules are also
// re-exported for finer-grained access where needed.

export { buildContext, buildReportContext } from './build.js';
export {
	type BuildIntelligenceOptions,
	type GetOrComputeSnapshotOptions,
	type SnapshotResolution,
	buildIntelligence,
	getOrComputeSnapshot,
	loadEmergingTopics,
	loadEntities,
	loadSentimentBreakdown,
	loadTopAuthors,
	loadTopDiscussions,
	loadTopicClusters,
	loadTrendingKeywords
} from './intelligence/index.js';
export { buildProduct } from './product/index.js';
export type { BuildProductOptions } from './product/index.js';
export type {
	AppContext,
	BuildContextOptions,
	ContextSlice,
	IntelligenceAuthor,
	IntelligenceContext,
	IntelligenceDiscussion,
	IntelligenceEntity,
	IntelligenceKeyword,
	IntelligenceTopicCluster,
	IntelligenceWindow,
	ProductContext,
	ProductPackageMetadata
} from './types.js';
