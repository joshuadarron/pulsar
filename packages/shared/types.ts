export type SourceOrigin = 'live' | 'wayback' | 'common_crawl' | 'direct_archive';
export type BackfillStatus = 'queued' | 'running' | 'complete' | 'failed';
export type BackfillJobStatus = 'queued' | 'claimed' | 'running' | 'complete' | 'failed';

export type BackfillRun = {
	id: string;
	sourceName: string;
	windowStart: Date;
	windowEnd: Date;
	status: BackfillStatus;
	articlesIngested: number;
	errors: unknown | null;
	startedAt: Date | null;
	completedAt: Date | null;
	createdAt: Date;
};

export type BackfillJob = {
	id: string;
	backfillRunId: string | null;
	sourceName: string;
	windowStart: Date;
	windowEnd: Date;
	strategy: string;
	status: BackfillJobStatus;
	attempts: number;
	claimedBy: string | null;
	claimedAt: Date | null;
	completedAt: Date | null;
	errorMessage: string | null;
	createdAt: Date;
};

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
	sourceOrigin?: SourceOrigin;
	backfillRunId?: string;
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
// Report data contract, stored as JSONB in reports.report_data
//
// Five-section structure with four generation passes:
//   Pass 1 (sequential): marketSnapshot, developerSignals
//   Pass 2: signalInterpretation (reads pass 1 text)
//   Pass 3: executiveSummary (reads all prior text)
//   Pass 4: supportingResources (ranks the aggregated research[] pool)
//
// The agent writes only to `text`, `research`, `interpretations`, `predictions`,
// and `resources` per section. Source-of-truth chart data is snapshotted into
// `charts` at generation time so rendering is deterministic.
// ---------------------------------------------------------------------------

export interface ReportData {
	reportMetadata: ReportMetadata;
	sections: ReportSections;
	charts: ReportCharts;
}

export interface ReportMetadata {
	periodStart: string;
	periodEnd: string;
	sourcesCount: number;
	articleCount: number;
}

/**
 * Sections render in the order they appear here:
 *   1. executiveSummary (top-of-report synthesis, 100-150 words)
 *   2. marketSnapshot (200-300 words)
 *   3. developerSignals (200-300 words)
 *   4. signalInterpretation (300-400 words: intro + 3-7 interpretations)
 *   5. supportingResources (10 ranked links)
 */
export interface ReportSections {
	executiveSummary: ExecutiveSummarySection;
	marketSnapshot: MarketSnapshotSection;
	developerSignals: DeveloperSignalsSection;
	signalInterpretation: SignalInterpretationSection;
	supportingResources: SupportingResourcesSection;
}

// --- Section shapes ---

export interface MarketSnapshotSection {
	/** 2-3 paragraphs of operator-facing analysis. */
	text: string;
	research?: ResearchCitation[];
}

export interface DeveloperSignalsSection {
	/** 2-3 paragraphs. No top-author tables, no sentiment dump. */
	text: string;
	research?: ResearchCitation[];
}

export interface SignalInterpretation {
	/** The exact data point being interpreted. */
	signal: string;
	/** What this signal tells us about the market. */
	meaning: string;
	/** What it means for the operator's positioning. */
	implication: string;
}

export interface SignalInterpretationSection {
	/** Intro paragraph framing what this section is. */
	text: string;
	/** 3-7 items, picked by the LLM based on signal strength. */
	interpretations: SignalInterpretation[];
	research?: ResearchCitation[];
}

export interface SupportingResource {
	url: string;
	title: string;
	/** One short technical sentence explaining what the reader gains. */
	why: string;
}

export interface SupportingResourcesSection {
	/** Up to 10 (fewer when the research pool is thin). */
	resources: SupportingResource[];
}

/** Executive summary has no research; it synthesizes prior sections only. */
export interface ExecutiveSummarySection {
	/** 100-150 word, 3-5 sentence synthesis. */
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

// --- Chart snapshots persisted into report_data.charts at generation time ---

export interface ReportCharts {
	keywordDistribution: KeywordDistribution;
	entityCentrality: EntityCentralitySeries;
}

/**
 * Snapshot of `/api/charts/keyword-distribution` at the time of report
 * generation. The last bucket may carry the label `Other` when the long
 * tail is non-empty.
 */
export interface KeywordDistribution {
	windowStart: string;
	windowEnd: string;
	totalArticles: number;
	buckets: Array<{ keyword: string; count: number; pct: number }>;
}

/**
 * Snapshot of `/api/charts/entity-centrality` at the time of report
 * generation. `sparse` is true when fewer periods are present than the
 * runner requested (typical until backfill catches up).
 */
export interface EntityCentralitySeries {
	currentPeriodEnd: string;
	periodKind: 'month';
	sparse: boolean;
	series: Array<{
		entityName: string;
		points: Array<{ period: string; centrality: number; mentions: number }>;
	}>;
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

// ---------------------------------------------------------------------------
// Backwards compatibility: legacy report rows persisted before Phase 4 use
// `marketLandscape`, `technologyTrends`, and `contentRecommendations`. They
// remain queryable from JSONB but no longer satisfy `ReportSections`. The
// rendering layer dispatches on this discriminator and renders the legacy
// path when it matches.
// ---------------------------------------------------------------------------

export interface LegacyReportSectionsShape {
	marketLandscape?: unknown;
	technologyTrends?: unknown;
	contentRecommendations?: unknown;
}

export interface LegacyReportData {
	reportMetadata?: unknown;
	sections: LegacyReportSectionsShape;
	charts?: unknown;
}

/**
 * True when `data` matches the pre-Phase-4 report shape. Detection is
 * positive: at least one legacy section key (`marketLandscape`,
 * `technologyTrends`, or `contentRecommendations`) is present under
 * `sections`. This intentionally stays loose so old rows render.
 */
export function isLegacyReportData(data: unknown): data is LegacyReportData {
	if (!data || typeof data !== 'object') return false;
	const sections = (data as { sections?: unknown }).sections;
	if (!sections || typeof sections !== 'object') return false;
	const s = sections as Record<string, unknown>;
	return 'marketLandscape' in s || 'technologyTrends' in s || 'contentRecommendations' in s;
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
// Graph snapshot, stored as JSONB in graph_snapshots, computed once per
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

// ---------------------------------------------------------------------------
// Historical analytics (Phase 3): period-over-period deltas and trajectories
// for entities. Computed by `@pulsar/scraper/analytics` and merged into the
// section-input shape consumed by trend-report prompts.
// ---------------------------------------------------------------------------

/**
 * Per-period historical sample for one entity. `period` is a label such as
 * "2024-01" (monthly) or "2024" (yearly). `mentions` is the article-mention
 * count in that period. `centrality` is the persisted pagerank score from the
 * `graph_snapshots` row closest to that period, or 0 when no snapshot exists.
 */
export type Trajectory = Array<{
	period: string;
	mentions: number;
	centrality: number;
}>;

/**
 * Top-N current-period entity, optionally enriched with historical context.
 * `history` is omitted when the analytics layer has nothing to report for
 * the entity (sparse data, missing snapshots, or fetch failure).
 */
export type EntityWithHistory = GraphSnapshotEntity & {
	history?: {
		twelveMonthDelta: number;
		yoyDelta: number;
		trajectory: Trajectory;
	};
};

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
