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
  type: "company" | "tool" | "model" | "language" | "person" | "concept";
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

export interface ReportData {
  executiveSummary: string;
  period: { start: string; end: string };
  articleCount: number;
  trendingKeywords: TrendingKeyword[];
  trendingTopics: TrendingTopic[];
  trendingTechnologies: TrendingTechnology[];
  emergingTopics: string[];
  entityProminence: EntityProminence[];
  topicCoOccurrence: TopicCoOccurrence[];
  velocityOutliers: VelocityOutlier[];
  contentOpportunities: ContentOpportunity[];
  sourceDistribution: SourceDistribution[];
  narrativeAnalysis: NarrativeAnalysis;
}

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

export interface ContentOpportunity {
  signal: string;
  source: string;
  url: string;
}

export interface SourceDistribution {
  source: string;
  articleCount: number;
  topTopics: string[];
}

export interface NarrativeAnalysis {
  keywords: string;
  topics: string;
  technologies: string;
  opportunities: string;
}

export interface ContentDraft {
  id: string;
  runId: string;
  reportId: string;
  platform: string;
  contentType: string;
  body: string;
  status: "draft" | "approved" | "exported";
  createdAt: Date;
  updatedAt: Date;
}

export interface Run {
  id: string;
  startedAt: Date;
  completedAt?: Date;
  status: "running" | "complete" | "failed";
  trigger: "scheduled" | "manual";
  runType: "scrape" | "pipeline";
  articlesScraped: number;
  articlesNew: number;
  errorLog?: string;
}
