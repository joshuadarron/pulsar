import type { OperatorContext } from '@pulsar/context';
import type { Trajectory } from '@pulsar/shared/types';
import type { VoiceContext, VoiceFormat } from '@pulsar/voice';

export type ContextSlice = 'operator' | 'voice' | 'intelligence' | 'product';

export type IntelligenceWindow = {
	start: Date;
	end: Date;
};

export type BuildContextOptions = {
	/** Which slices to include in the returned AppContext. */
	slices: readonly ContextSlice[];
	/** Required when 'intelligence' is in slices and no reportId is provided. */
	window?: IntelligenceWindow;
	/** Required when 'voice' is in slices. */
	voiceFormats?: readonly VoiceFormat[];
	/** Shorthand: derive window + graph_snapshot_id from this report row. */
	reportId?: string;
	/** Override the snapshot used for intelligence (skips lookup + staleness check). */
	graphSnapshotId?: string;
	/** Force a fresh snapshot compute regardless of cache state. */
	forceRecomputeSnapshot?: boolean;
};

export type IntelligenceEntity = {
	name: string;
	type: string;
	pagerankScore: number;
	pagerankRank: number;
	mentionCount: number;
	history?: {
		twelveMonthDelta: number;
		yoyDelta: number;
		trajectory: Trajectory;
	};
};

export type IntelligenceKeyword = {
	keyword: string;
	count7d: number;
	count30d: number;
	delta: number;
	velocitySpike?: number;
};

export type IntelligenceTopicCluster = {
	clusterId: number;
	nodeCount: number;
	topTopics: string[];
};

export type IntelligenceDiscussion = {
	title: string;
	url: string;
	source: string;
	commentCount: number;
};

export type IntelligenceAuthor = {
	handle: string;
	platform: string;
	articleCount: number;
};

export type IntelligenceContext = {
	period: IntelligenceWindow;
	graphSnapshotId: string;
	graphSnapshotSource: 'cached' | 'recomputed';
	articleCount: number;
	sourceCount: number;
	entities: IntelligenceEntity[];
	trendingKeywords: IntelligenceKeyword[];
	topicClusters: IntelligenceTopicCluster[];
	topDiscussions: IntelligenceDiscussion[];
	sentimentBreakdown: {
		positive: number;
		neutral: number;
		negative: number;
	};
	topAuthors: IntelligenceAuthor[];
	emergingTopics: string[];
};

export type ProductPackageMetadata = {
	name: string;
	version: string;
	summary: string;
};

export type ProductContext = {
	positioning: string;
	packages: ProductPackageMetadata[];
	groundingUrls: string[];
	scrapedSiteContent?: string;
};

export type AppContext = {
	operator?: OperatorContext;
	voice?: VoiceContext;
	intelligence?: IntelligenceContext;
	product?: ProductContext;
};
