export interface ScrapedItem {
	url: string;
	title: string;
	rawContent: string;
	publishedAt: Date;
	author?: string;
	score?: number;
	commentCount?: number;
	sourceName: string;
	sourcePlatform: string;
}

export type SourceAdapter = () => Promise<ScrapedItem[]>;

export interface ArticleRaw {
	id: string;
	urlHash: string;
	url: string;
	rawPayload: Record<string, unknown>;
	sourceName: string;
	scrapedAt: Date;
	runId: string;
}

export interface Article {
	id: string;
	rawId: string;
	url: string;
	title: string;
	summary?: string;
	contentType?: string;
	sentiment?: string;
	topicTags?: string[];
	entityMentions?: EntityMention[];
	publishedAt: Date;
	sourceName: string;
	sourcePlatform: string;
	score?: number;
	commentCount?: number;
	enrichedAt?: Date;
	runId: string;
}

export interface EntityMention {
	name: string;
	type: 'company' | 'tool' | 'model' | 'language' | 'person' | 'concept';
}

export interface Report {
	id: string;
	runId: string;
	generatedAt: Date;
	periodStart: Date;
	periodEnd: Date;
	reportData: ReportData;
	articleCount: number;
}

// ---------------------------------------------------------------------------
// Report data contract — stored as JSONB in reports.report_data
//
// Five-section structure with three generation passes:
//   Pass 1 (parallel): marketLandscape, technologyTrends, developerSignals
//   Pass 2: contentRecommendations (reads pass 1 text only)
//   Pass 3: executiveSummary (reads all prior text)
//
// The agent NEVER mutates `data`. It writes only to `text` and `research`.
// Sections without `data` omit the field entirely.
// ---------------------------------------------------------------------------

export interface ReportData {
	reportMetadata: ReportMetadata;
	sections: ReportSections;
}

export interface ReportMetadata {
	periodStart: string;
	periodEnd: string;
	sourcesCount: number;
	articleCount: number;
}

export interface ReportSections {
	marketLandscape: MarketLandscapeSection;
	technologyTrends: TechnologyTrendsSection;
	developerSignals: DeveloperSignalsSection;
	contentRecommendations: ContentRecommendationsSection;
	executiveSummary: ExecutiveSummarySection;
}

// --- Sections with data + text + optional research ---

export interface MarketLandscapeSection {
	data: MarketLandscapeData;
	text: string;
	research?: ResearchCitation[];
}

export interface TechnologyTrendsSection {
	data: TechnologyTrendsData;
	text: string;
	research?: ResearchCitation[];
}

export interface DeveloperSignalsSection {
	data: DeveloperSignalsData;
	text: string;
	research?: ResearchCitation[];
}

// --- Sections with text only (no data, no visuals) ---

export interface ContentRecommendationsSection {
	text: string;
	research?: ResearchCitation[];
}

/** Executive summary has no research — it synthesizes prior sections only. */
export interface ExecutiveSummarySection {
	text: string;
}

// --- Per-section data shapes (read-only input to the agent) ---

export interface MarketLandscapeData {
	entities: EntityProminence[];
	technologies: TrendingTechnology[];
	sourceDistribution: SourceDistribution[];
}

export interface TechnologyTrendsData {
	keywords: TrendingKeyword[];
	topics: TrendingTopic[];
	velocityOutliers: VelocityOutlier[];
	topicCoOccurrence: TopicCoOccurrence[];
	emergingTopics: string[];
}

export interface DeveloperSignalsData {
	sentimentBreakdown: SentimentBreakdown;
	topAuthors: TopAuthor[];
	topDiscussions: TopDiscussion[];
}

export interface SentimentBreakdown {
	positive: number;
	negative: number;
	neutral: number;
}

export interface TopAuthor {
	handle: string;
	platform: string;
	articleCount: number;
}

export interface TopDiscussion {
	title: string;
	url: string;
	commentCount: number;
	source: string;
}

// --- Shared data sub-types (used inside section data) ---

export interface TrendingKeyword {
	keyword: string;
	count7d: number;
	count30d: number;
	delta: number;
}

export interface TrendingTopic {
	topic: string;
	trendScore: number;
	sentiment: string;
	articleCount: number;
	sparkline: number[];
}

export interface TrendingTechnology {
	name: string;
	type: string;
	mentionCount: number;
}

export interface EntityProminence {
	name: string;
	type: string;
	mentionCount: number;
}

export interface TopicCoOccurrence {
	topicA: string;
	topicB: string;
	count: number;
}

export interface VelocityOutlier {
	topic: string;
	spike: number;
	baseline: number;
}

export interface SourceDistribution {
	source: string;
	articleCount: number;
}

// --- Research citation (optional per-section output from the agent) ---

export interface ResearchCitation {
	/** URL of the source consulted */
	url: string;
	/** Category: documentation, blog, repository, social, news */
	sourceType: 'documentation' | 'blog' | 'repository' | 'social' | 'news';
	/** The specific claim in `text` this citation supports */
	claimSupported: string;
	/** Relevant excerpt from the source */
	excerpt: string;
	/** ISO-8601 timestamp when the source was retrieved */
	retrievedAt: string;
}

// --- Content drafts and runs (unchanged) ---

export interface ContentDraft {
	id: string;
	runId: string;
	reportId: string;
	platform: string;
	contentType: string;
	body: string;
	status: 'draft' | 'approved' | 'exported';
	createdAt: Date;
	updatedAt: Date;
}

export interface Run {
	id: string;
	startedAt: Date;
	completedAt?: Date;
	status: 'running' | 'complete' | 'failed';
	trigger: 'scheduled' | 'manual';
	runType: 'scrape' | 'pipeline';
	articlesScraped: number;
	articlesNew: number;
	errorLog?: string;
}
