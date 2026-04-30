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
	sourceCategory?: string;
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
//   Pass 1 (sequential): marketLandscape, technologyTrends, developerSignals
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
	/** Time-bounded predictions emitted alongside the synthesis (Phase D.2). */
	predictions?: ExtractedPrediction[];
}

/** Forward-looking claim emitted by the executive-summary pass and persisted to report_predictions. */
export interface ExtractedPrediction {
	prediction_text: string;
	predicted_entities: string[];
	predicted_topics: string[];
	prediction_type: PredictionType;
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

// ---------------------------------------------------------------------------
// Graph snapshot — stored as JSONB in graph_snapshots, computed once per
// pipeline run via gds.louvain (Topics) and gds.pageRank (Entities).
// Emergence is derived at trend-report time by diffing two snapshots.
// ---------------------------------------------------------------------------

export interface GraphSnapshotClusterTopic {
	name: string;
	trend_score: number;
}

export interface GraphSnapshotCluster {
	cluster_id: number;
	topic_count: number;
	topics: GraphSnapshotClusterTopic[];
}

export interface GraphSnapshotEntity {
	name: string;
	type: string;
	pagerank_score: number;
	pagerank_rank: number;
	mention_count: number;
}

export interface GraphSnapshot {
	id: string;
	run_id: string | null;
	computed_at: string;
	topic_clusters: GraphSnapshotCluster[];
	entity_importance: GraphSnapshotEntity[];
	metadata: Record<string, unknown>;
}

export interface EmergingEntity {
	name: string;
	type: string;
	current_rank: number;
	prior_rank: number | null;
	current_mentions: number;
	prior_mentions: number;
	mention_growth_multiplier: number | null;
}

// ---------------------------------------------------------------------------
// Phase D: Evaluation framework
// pipeline_validations, evaluations, report_predictions, retrospective_grades
// ---------------------------------------------------------------------------

export interface ValidationCheck {
	check_name: string;
	passed: boolean;
	detail?: string;
}

export interface PipelineValidation {
	id: string;
	run_id: string;
	pipeline_name: string;
	validated_at: string;
	passed: boolean;
	checks: ValidationCheck[];
	error_summary: string | null;
}

export type EvaluationTargetType = 'trend_report' | 'content_draft';

export interface Evaluation {
	id: string;
	run_id: string;
	target_type: EvaluationTargetType;
	target_id: string | null;
	dimension: string;
	score: number | null;
	passed: boolean | null;
	rationale: string | null;
	judge_model: string;
	judged_at: string;
}

export type PredictionType = 'emergence' | 'cluster_growth' | 'entity_importance' | 'general';

export interface ReportPrediction {
	id: string;
	report_id: string;
	prediction_text: string;
	predicted_entities: string[];
	predicted_topics: string[];
	prediction_type: PredictionType;
	extracted_at: string;
}

export type RetrospectiveOutcome = 'confirmed' | 'partially_confirmed' | 'refuted' | 'inconclusive';

export interface RetrospectiveGrade {
	id: string;
	prediction_id: string;
	graded_at: string;
	outcome: RetrospectiveOutcome;
	evidence_summary: string;
	judge_model: string;
	evidence_data: Record<string, unknown> | null;
}

export interface DraftEvalSummary {
	platform: string;
	llmScore: number;
	llmMax: number;
	subChecksPassed: number;
	subChecksTotal: number;
	failedSubChecks: string[];
}

export interface EvaluationSummary {
	reportScore: { total: number; max: number; lowestDim: { name: string; score: number } | null };
	draftScores: DraftEvalSummary[];
}

// ---------------------------------------------------------------------------
// App framework
//
// Each app under `packages/apps/<name>/` exports an `AppConfig` from its
// `app.config.ts`. The config declares the app's name, its scheduling
// requirements, what kind of output it produces, what shape it expects
// from `.context/` and `.voice/`, and which render mode the UI should use.
// ---------------------------------------------------------------------------

export interface AppScheduleEntry {
	hour: number;
	minute: number;
}

export interface AppSchedule {
	trendReport?: AppScheduleEntry;
	contentDrafts?: string | AppScheduleEntry;
}

export type AppOutputType = 'report' | 'brief' | 'draft';

export type AppRenderMode = 'technical' | 'newsletter';

export interface AppConfig {
	name: string;
	description: string;
	schedule: AppSchedule;
	outputType: AppOutputType;
	renderMode: AppRenderMode;
	expectedContext: string[];
	expectedVoiceFormats: string[];
}
