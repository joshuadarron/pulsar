// Single import surface for any app that needs to construct LLM context.
// Apps consume `buildContext({ slices })` or the `buildReportContext(reportId)`
// shorthand; the underlying intelligence/ and product/ modules are also
// re-exported for finer-grained access where needed.
//
// Operator profile and voice profile loaders are re-exported here so callers
// have one import surface. Behind the scenes those are sourced from
// @pulsar/operator-context and @pulsar/voice respectively.

export {
	ALL_OPERATOR_DOMAINS,
	type OperatorContext,
	OperatorContextNotConfiguredError,
	type OperatorDomain,
	type TrackedEntities,
	loadOperatorContext
} from '@pulsar/operator-context';
export {
	ALL_VOICE_FORMATS,
	type VoiceContext,
	VoiceContextNotConfiguredError,
	type VoiceFormat,
	type VoiceProfile,
	loadVoiceContext
} from '@pulsar/voice';

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
