import path from 'node:path';
import { pipelinesDir as PIPELINES_DIR } from '@pulsar/app-market-analysis/pipelines';
import {
	buildSectionPrompts,
	buildSystemPrompt
} from '@pulsar/app-market-analysis/prompts/trend-report';
import {
	type OperatorContext,
	OperatorContextNotConfiguredError,
	loadOperatorContext
} from '@pulsar/context';
import { enrichEntitiesWithHistory, fetchEntityHistory } from '@pulsar/scraper/analytics';
import { getSession } from '@pulsar/shared/db/neo4j';
import { query } from '@pulsar/shared/db/postgres';
import { logRun } from '@pulsar/shared/run-logger';
import type {
	EmergingEntity,
	EntityCentralitySeries,
	EntityWithHistory,
	ExtractedPrediction,
	GraphSnapshot,
	GraphSnapshotCluster,
	GraphSnapshotEntity,
	KeywordDistribution,
	ReportCharts,
	ReportData,
	ResearchCitation,
	SignalInterpretation,
	SupportingResource
} from '@pulsar/shared/types';
import { loadVoiceContext } from '@pulsar/voice';
import {
	type ContentDraftRow,
	orchestrateContentDrafts
} from './lib/content-drafts-orchestrator.js';
import { extractPredictions } from './lib/evals/extract.js';
import { persistValidation } from './lib/evals/persist.js';
import { runEvaluations } from './lib/evals/runner.js';
import { VALIDATOR_SUITES, runValidators } from './lib/evals/validators.js';
import { type RocketRideContext, fetchRocketRideContext } from './lib/fetch-rocketride-context.js';
import { extractJson } from './lib/parse-json.js';
import { disconnectClient, getClient, terminatePipeline, usePipeline } from './lib/rocketride.js';
import { sendReportEmail } from './notify.js';

const TREND_REPORT_PIPE = path.join(PIPELINES_DIR, 'trend-report.pipe');

const MAX_SNAPSHOT_AGE_HOURS = 48;

async function validateAndPersist(
	runId: string,
	pipelineName: string,
	output: unknown
): Promise<void> {
	const suite = VALIDATOR_SUITES[pipelineName];
	if (!suite) return;
	try {
		const result = runValidators(suite, output);
		await persistValidation(runId, pipelineName, result);
		if (!result.passed) {
			await logRun(
				runId,
				'warn',
				'validation',
				`${pipelineName} validation failures: ${result.error_summary}`
			);
		}
	} catch (err) {
		await logRun(runId, 'warn', 'validation', `${pipelineName} validator threw: ${err}`);
	}
}

// ---------------------------------------------------------------------------
// Graph snapshot computation (deterministic, no LLM, no RocketRide pipe).
// Runs GDS Louvain on filtered Topics and GDS PageRank on the Entity
// co-mention graph directly via the neo4j-driver session, assembles the
// envelope in TS, and persists one row to graph_snapshots per run.
// ---------------------------------------------------------------------------

interface GraphSnapshotEnvelope {
	topic_clusters: GraphSnapshotCluster[];
	entity_importance: GraphSnapshotEntity[];
	metadata: Record<string, unknown>;
}

interface LouvainRow {
	communityId: number;
	name: string;
	trendScore: number;
}

interface PageRankRow {
	name: string;
	type: string;
	pagerank_score: number;
	mention_count: number;
}

function neoToNum(value: unknown): number {
	if (typeof value === 'object' && value !== null && 'toNumber' in value) {
		return (value as { toNumber(): number }).toNumber();
	}
	return value as number;
}

async function safeDropProjection(
	session: ReturnType<typeof getSession>,
	name: string
): Promise<void> {
	const exists = await session.run('CALL gds.graph.exists($name) YIELD exists RETURN exists', {
		name
	});
	if (exists.records[0]?.get('exists')) {
		await session.run('CALL gds.graph.drop($name) YIELD graphName RETURN graphName', { name });
	}
}

function buildClusters(rows: LouvainRow[]): GraphSnapshotCluster[] {
	const groups = new Map<number, { name: string; trend_score: number }[]>();
	for (const row of rows) {
		const list = groups.get(row.communityId) ?? [];
		list.push({ name: row.name, trend_score: row.trendScore });
		groups.set(row.communityId, list);
	}
	const clusters: GraphSnapshotCluster[] = [];
	for (const [cluster_id, topics] of groups) {
		const sorted = topics.sort((a, b) => b.trend_score - a.trend_score).slice(0, 20);
		clusters.push({ cluster_id, topic_count: topics.length, topics: sorted });
	}
	clusters.sort((a, b) => b.topic_count - a.topic_count);
	return clusters;
}

function buildEntityImportance(rows: PageRankRow[]): GraphSnapshotEntity[] {
	return rows.map((row, idx) => ({
		name: row.name,
		type: row.type,
		pagerank_score: row.pagerank_score,
		pagerank_rank: idx + 1,
		mention_count: row.mention_count
	}));
}

async function runGraphSnapshot(
	_client: Awaited<ReturnType<typeof getClient>>,
	runId: string
): Promise<string | null> {
	const session = getSession();
	try {
		await logRun(
			runId,
			'info',
			'graph-snapshot',
			'Computing graph snapshot (Louvain + PageRank)...'
		);

		// Louvain on filtered Topics.
		await safeDropProjection(session, 'topic_louvain_graph');
		let louvainRows: LouvainRow[] = [];
		try {
			await session.run(
				`CALL gds.graph.project.cypher(
					'topic_louvain_graph',
					'MATCH (t:Topic) WHERE t.lastSeen > datetime() - duration({days: 7}) AND COUNT { (t)<-[:TAGGED_WITH]-() } >= 3 RETURN id(t) AS id',
					'MATCH (t1:Topic)-[r:RELATED_TO]-(t2:Topic) WHERE t1.lastSeen > datetime() - duration({days: 7}) AND t2.lastSeen > datetime() - duration({days: 7}) AND COUNT { (t1)<-[:TAGGED_WITH]-() } >= 3 AND COUNT { (t2)<-[:TAGGED_WITH]-() } >= 3 RETURN id(t1) AS source, id(t2) AS target, r.weight AS weight'
				) YIELD graphName, nodeCount, relationshipCount RETURN graphName, nodeCount, relationshipCount`
			);
			const louvainResult = await session.run(
				`CALL gds.louvain.stream('topic_louvain_graph', { relationshipWeightProperty: 'weight' })
				 YIELD nodeId, communityId
				 WITH nodeId, communityId, gds.util.asNode(nodeId) AS topic
				 RETURN communityId, topic.name AS name, topic.trendScore AS trendScore
				 ORDER BY communityId, trendScore DESC`
			);
			louvainRows = louvainResult.records.map((r) => ({
				communityId: neoToNum(r.get('communityId')),
				name: r.get('name'),
				trendScore: neoToNum(r.get('trendScore'))
			}));
		} finally {
			await safeDropProjection(session, 'topic_louvain_graph');
		}

		// PageRank on the Entity co-mention graph.
		await safeDropProjection(session, 'entity_pagerank_graph');
		let pageRankRows: PageRankRow[] = [];
		try {
			await session.run(
				`CALL gds.graph.project.cypher(
					'entity_pagerank_graph',
					'MATCH (e:Entity) RETURN id(e) AS id',
					'MATCH (e1:Entity)<-[:MENTIONS]-(a:Article)-[:MENTIONS]->(e2:Entity) WHERE id(e1) < id(e2) WITH e1, e2, count(a) AS coMentionCount RETURN id(e1) AS source, id(e2) AS target, coMentionCount AS weight'
				) YIELD graphName, nodeCount, relationshipCount RETURN graphName, nodeCount, relationshipCount`
			);
			const prResult = await session.run(
				`CALL gds.pageRank.stream('entity_pagerank_graph', { relationshipWeightProperty: 'weight' })
				 YIELD nodeId, score
				 WITH nodeId, score, gds.util.asNode(nodeId) AS entity
				 RETURN entity.name AS name, entity.type AS type, score AS pagerank_score, COUNT { (entity)<-[:MENTIONS]-() } AS mention_count
				 ORDER BY score DESC`
			);
			pageRankRows = prResult.records.map((r) => ({
				name: r.get('name'),
				type: r.get('type'),
				pagerank_score: neoToNum(r.get('pagerank_score')),
				mention_count: neoToNum(r.get('mention_count'))
			}));
		} finally {
			await safeDropProjection(session, 'entity_pagerank_graph');
		}

		const versionResult = await session.run('RETURN gds.version() AS version');
		const gdsVersion: string = versionResult.records[0]?.get('version') ?? 'unknown';

		const envelope: GraphSnapshotEnvelope = {
			topic_clusters: buildClusters(louvainRows),
			entity_importance: buildEntityImportance(pageRankRows),
			metadata: {
				louvain_filter: 'lastSeen > 7d AND article_count >= 3',
				total_topics_clustered: louvainRows.length,
				total_entities_ranked: pageRankRows.length,
				gds_version: gdsVersion
			}
		};

		// Defense in depth: if either array is empty there is nothing useful to
		// inject into the trend report. Skip the insert so the prior good
		// snapshot remains the most recent for loadGraphSnapshots() consumers.
		if (envelope.topic_clusters.length === 0 && envelope.entity_importance.length === 0) {
			await logRun(
				runId,
				'warn',
				'graph-snapshot',
				`Snapshot empty (gds_version=${gdsVersion}, louvain_rows=${louvainRows.length}, pr_rows=${pageRankRows.length}), not persisting`
			);
			return null;
		}

		const insertResult = await query<{ id: string }>(
			`INSERT INTO graph_snapshots (run_id, topic_clusters, entity_importance, metadata)
			 VALUES ($1, $2, $3, $4) RETURNING id`,
			[
				runId,
				JSON.stringify(envelope.topic_clusters),
				JSON.stringify(envelope.entity_importance),
				JSON.stringify(envelope.metadata)
			]
		);

		const snapshotId = insertResult.rows[0].id;
		await logRun(
			runId,
			'success',
			'graph-snapshot',
			`Snapshot saved: ${snapshotId} (${envelope.topic_clusters.length} clusters, ${envelope.entity_importance.length} entities)`
		);
		return snapshotId;
	} catch (err) {
		await logRun(runId, 'warn', 'graph-snapshot', `Snapshot failed (soft fail): ${err}`);
		return null;
	} finally {
		await session.close();
	}
}

async function warnIfSnapshotStale(runId: string): Promise<void> {
	const result = await query<{ computed_at: Date }>(
		'SELECT computed_at FROM graph_snapshots ORDER BY computed_at DESC LIMIT 1'
	);
	if (result.rows.length === 0) {
		await logRun(
			runId,
			'warn',
			'graph-snapshot',
			'No graph snapshots exist yet, trend report will run without algorithm-derived fields'
		);
		return;
	}
	const ageMs = Date.now() - new Date(result.rows[0].computed_at).getTime();
	const ageHours = ageMs / (1000 * 60 * 60);
	if (ageHours > MAX_SNAPSHOT_AGE_HOURS) {
		await logRun(
			runId,
			'warn',
			'graph-snapshot',
			`Latest graph snapshot is ${ageHours.toFixed(1)}h old (>${MAX_SNAPSHOT_AGE_HOURS}h), trend report fields may be stale`
		);
	}
}

async function loadGraphSnapshots(): Promise<{
	current: GraphSnapshot | null;
	weekAgo: GraphSnapshot | null;
}> {
	const currentResult = await query<GraphSnapshot>(
		`SELECT id, run_id, computed_at, topic_clusters, entity_importance, metadata
		 FROM graph_snapshots ORDER BY computed_at DESC LIMIT 1`
	);
	const weekAgoResult = await query<GraphSnapshot>(
		`SELECT id, run_id, computed_at, topic_clusters, entity_importance, metadata
		 FROM graph_snapshots WHERE computed_at <= now() - interval '7 days'
		 ORDER BY computed_at DESC LIMIT 1`
	);
	return {
		current: currentResult.rows[0] ?? null,
		weekAgo: weekAgoResult.rows[0] ?? null
	};
}

function computeEmergingEntities(
	current: GraphSnapshot | null,
	weekAgo: GraphSnapshot | null
): EmergingEntity[] {
	if (!current || !weekAgo) return [];
	const weekAgoByName = new Map(weekAgo.entity_importance.map((e) => [e.name, e]));
	return current.entity_importance
		.filter((e) => e.pagerank_rank <= 10)
		.filter((e) => {
			const prior = weekAgoByName.get(e.name);
			const wasNotTop25 = !prior || prior.pagerank_rank > 25;
			const priorMentions = prior?.mention_count ?? 0;
			const grew2x = e.mention_count >= priorMentions * 2;
			return wasNotTop25 && grew2x;
		})
		.map((e) => {
			const prior = weekAgoByName.get(e.name);
			return {
				name: e.name,
				type: e.type,
				current_rank: e.pagerank_rank,
				prior_rank: prior?.pagerank_rank ?? null,
				current_mentions: e.mention_count,
				prior_mentions: prior?.mention_count ?? 0,
				mention_growth_multiplier: prior?.mention_count
					? e.mention_count / prior.mention_count
					: null
			};
		});
}

// ---------------------------------------------------------------------------
// Pipeline token tracking (for cancellation)
// ---------------------------------------------------------------------------

const activeRuns = new Map<
	string,
	{ client: Awaited<ReturnType<typeof getClient>>; token: string; aborted: boolean }
>();

export function cancelRun(runId: string): boolean {
	const active = activeRuns.get(runId);
	if (!active) return false;
	active.aborted = true;
	terminatePipeline(active.client, active.token).catch(() => {});
	return true;
}

export function isRunCancelled(runId: string): boolean {
	return activeRuns.get(runId)?.aborted === true;
}

function setActiveToken(
	runId: string,
	client: Awaited<ReturnType<typeof getClient>>,
	token: string
) {
	const existing = activeRuns.get(runId);
	if (existing?.aborted) throw new Error('Run was cancelled');
	activeRuns.set(runId, { client, token, aborted: existing?.aborted ?? false });
}

function checkCancelled(runId: string) {
	if (activeRuns.get(runId)?.aborted) throw new Error('Run was cancelled');
}

// ---------------------------------------------------------------------------
// Single-section pipeline invocation
//
// Each call starts a fresh pipeline instance, sends a payload with
// { prompt, data } and receives a JSON response: { text, research? }
// ---------------------------------------------------------------------------

interface SectionResponse {
	text: string;
	research?: ResearchCitation[];
	/** Only emitted by the executiveSummary pass. */
	predictions?: ExtractedPrediction[];
	/** Only emitted by the signalInterpretation pass. */
	interpretations?: SignalInterpretation[];
	/** Only emitted by the supportingResources pass. */
	resources?: SupportingResource[];
}

async function runSection(
	client: Awaited<ReturnType<typeof getClient>>,
	runId: string,
	sectionKey: string,
	sectionPrompts: Record<string, string>,
	systemPrompt: string,
	data: unknown
): Promise<SectionResponse> {
	checkCancelled(runId);

	const payload = {
		systemPrompt,
		prompt: sectionPrompts[sectionKey],
		data
	};

	const { token } = await usePipeline(client, runId, TREND_REPORT_PIPE);
	setActiveToken(runId, client, token);

	const response = await client.send(token, JSON.stringify(payload), {}, 'application/json');

	await terminatePipeline(client, token);

	const raw = response?.answers?.[0];

	// Build the parsed result, then check shape and log diagnostics if the
	// returned object lacks a usable text field. Single return point at end.
	let parsed: SectionResponse;

	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		const obj = raw as Record<string, unknown>;
		// supportingResources returns { resources: [...] } with no text field;
		// pretty-print resources count into a placeholder so downstream checks
		// for parsed.text still pass. Persistence reads resources directly.
		if (typeof obj.text !== 'string' && Array.isArray(obj.resources) && obj.resources.length >= 0) {
			parsed = {
				text: `Selected ${obj.resources.length} supporting resources.`,
				resources: obj.resources as SupportingResource[]
			};
		} else if (typeof obj.text === 'string') {
			parsed = {
				text: obj.text,
				...(Array.isArray(obj.research) ? { research: obj.research as ResearchCitation[] } : {}),
				...(Array.isArray(obj.predictions)
					? { predictions: obj.predictions as ExtractedPrediction[] }
					: {}),
				...(Array.isArray(obj.interpretations)
					? { interpretations: obj.interpretations as SignalInterpretation[] }
					: {}),
				...(Array.isArray(obj.resources)
					? { resources: obj.resources as SupportingResource[] }
					: {})
			};
		} else {
			// Object response without a top-level text key. Stringify and pass
			// through extractJson so we surface the same shape we used to.
			const str = JSON.stringify(raw);
			try {
				parsed = extractJson<SectionResponse>(str);
			} catch {
				parsed = { text: str.trim() || 'Analysis could not be generated for this section.' };
			}
		}
	} else {
		const str = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '{}');
		try {
			parsed = extractJson<SectionResponse>(str);
		} catch {
			parsed = { text: str.trim() || 'Analysis could not be generated for this section.' };
		}
	}

	// Diagnostic: if the parsed result has no usable text, capture the raw
	// shape so we can identify whether the agent is wrapping, echoing, or
	// emitting tool output. Fires only on failure, no noise on success.
	const parsedText = (parsed as { text?: unknown }).text;
	if (typeof parsedText !== 'string' || parsedText.trim().length === 0) {
		const rawType = Array.isArray(raw) ? 'array' : typeof raw;
		const rawKeys =
			raw && typeof raw === 'object' && !Array.isArray(raw)
				? Object.keys(raw as Record<string, unknown>).join(',')
				: 'n/a';
		const preview = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
		await logRun(
			runId,
			'warn',
			'trend-report-debug',
			`[${sectionKey}] response missing text. raw_type=${rawType} keys=${rawKeys} preview=${preview.slice(0, 600)}`
		);
	}

	return parsed;
}

// ---------------------------------------------------------------------------
// Data gathering: Neo4j + PostgreSQL queries
//
// Phase 4 trimmed the section payload shapes:
//   marketSnapshot: { sourceDistribution }
//   developerSignals: { sentimentBreakdown, topDiscussions }
// Top-author tables, raw entity/technology lists, and the legacy keyword/
// topic dump no longer feed any prompt. Charts pull their data via the
// dedicated `gatherChartData` helpers below.
// ---------------------------------------------------------------------------

interface SourceDistributionRow {
	source: string;
	articleCount: number;
}

interface SentimentBreakdown {
	positive: number;
	negative: number;
	neutral: number;
}

interface TopDiscussion {
	title: string;
	url: string;
	commentCount: number;
	source: string;
}

async function gatherSourceDistribution(): Promise<SourceDistributionRow[]> {
	const session = getSession();
	try {
		const result = await session.run(
			`MATCH (a:Article)-[:FROM_SOURCE]->(s:Source)
			 WHERE a.publishedAt > datetime() - duration('P7D')
			 RETURN s.name AS source, count(a) AS articleCount
			 ORDER BY articleCount DESC`
		);
		return result.records.map((r) => ({
			source: r.get('source'),
			articleCount: neoToNum(r.get('articleCount'))
		}));
	} finally {
		await session.close();
	}
}

async function gatherDeveloperSignalsInputs(): Promise<{
	sentimentBreakdown: SentimentBreakdown;
	topDiscussions: TopDiscussion[];
}> {
	const sentimentResult = await query<{ sentiment: string; count: string }>(
		`SELECT COALESCE(sentiment, 'neutral') AS sentiment, count(*) AS count
		 FROM articles
		 WHERE published_at > now() - interval '7 days'
		 GROUP BY sentiment`
	);
	const sentimentBreakdown: SentimentBreakdown = { positive: 0, negative: 0, neutral: 0 };
	for (const row of sentimentResult.rows) {
		const key = row.sentiment as keyof SentimentBreakdown;
		if (key in sentimentBreakdown) {
			sentimentBreakdown[key] = Number.parseInt(row.count);
		}
	}

	const discussionsResult = await query<{
		title: string;
		url: string;
		comment_count: string;
		source_name: string;
	}>(
		`SELECT title, url, COALESCE(comment_count, 0) AS comment_count, source_name
		 FROM articles
		 WHERE published_at > now() - interval '7 days'
		   AND comment_count IS NOT NULL AND comment_count > 0
		 ORDER BY comment_count DESC LIMIT 10`
	);
	const topDiscussions = discussionsResult.rows.map((r) => ({
		title: r.title,
		url: r.url,
		commentCount: Number.parseInt(r.comment_count),
		source: r.source_name
	}));

	return { sentimentBreakdown, topDiscussions };
}

// ---------------------------------------------------------------------------
// Chart data snapshots (persisted into report_data.charts).
//
// Shapes match the Phase 3 endpoints exactly so the rendering layer can use
// the same helpers across both surfaces:
//   GET /api/charts/keyword-distribution
//   GET /api/charts/entity-centrality
// ---------------------------------------------------------------------------

const KEYWORD_DISTRIBUTION_TOP = 10;
const KEYWORD_DISTRIBUTION_WINDOW_DAYS = 30;
const ENTITY_CENTRALITY_PERIODS = 12;
const ENTITY_CENTRALITY_TOP = 5;

async function gatherKeywordDistribution(): Promise<KeywordDistribution> {
	const windowEnd = new Date();
	const windowStart = new Date(
		windowEnd.getTime() - KEYWORD_DISTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000
	);

	const articlesResult = await query<{ total_articles: string }>(
		`SELECT COUNT(*)::text AS total_articles
		 FROM articles
		 WHERE published_at >= $1 AND published_at <= $2`,
		[windowStart.toISOString(), windowEnd.toISOString()]
	);
	const totalArticles = Number.parseInt(articlesResult.rows[0]?.total_articles ?? '0', 10);

	if (totalArticles === 0) {
		return {
			windowStart: windowStart.toISOString(),
			windowEnd: windowEnd.toISOString(),
			totalArticles: 0,
			buckets: []
		};
	}

	const totalsResult = await query<{ total: string }>(
		`SELECT COUNT(*)::text AS total
		 FROM articles, unnest(topic_tags) AS keyword
		 WHERE published_at >= $1 AND published_at <= $2
		   AND topic_tags IS NOT NULL`,
		[windowStart.toISOString(), windowEnd.toISOString()]
	);
	const totalMentions = Number.parseInt(totalsResult.rows[0]?.total ?? '0', 10);

	if (totalMentions === 0) {
		return {
			windowStart: windowStart.toISOString(),
			windowEnd: windowEnd.toISOString(),
			totalArticles,
			buckets: []
		};
	}

	const topResult = await query<{ keyword: string; count: string }>(
		`SELECT keyword, COUNT(*)::text AS count
		 FROM articles, unnest(topic_tags) AS keyword
		 WHERE published_at >= $1 AND published_at <= $2
		   AND topic_tags IS NOT NULL
		 GROUP BY keyword
		 ORDER BY COUNT(*) DESC, keyword ASC
		 LIMIT $3`,
		[windowStart.toISOString(), windowEnd.toISOString(), KEYWORD_DISTRIBUTION_TOP]
	);

	const topEntries = topResult.rows.map((row) => {
		const count = Number.parseInt(row.count, 10);
		return {
			keyword: row.keyword,
			count,
			pct: (count / totalMentions) * 100
		};
	});

	const topSum = topEntries.reduce((acc, e) => acc + e.count, 0);
	const otherCount = totalMentions - topSum;
	const buckets = [...topEntries];
	if (otherCount > 0) {
		buckets.push({
			keyword: 'Other',
			count: otherCount,
			pct: (otherCount / totalMentions) * 100
		});
	}

	return {
		windowStart: windowStart.toISOString(),
		windowEnd: windowEnd.toISOString(),
		totalArticles,
		buckets
	};
}

interface SnapshotByPeriodRow {
	period: string;
	entity_importance: Array<{
		name: string;
		pagerank_score?: number;
		mention_count?: number;
	}>;
}

async function gatherEntityCentrality(): Promise<EntityCentralitySeries> {
	const currentPeriodEnd = new Date();
	const cutoff = new Date(
		Date.UTC(
			currentPeriodEnd.getUTCFullYear(),
			currentPeriodEnd.getUTCMonth() - (ENTITY_CENTRALITY_PERIODS - 1),
			1,
			0,
			0,
			0
		)
	);

	const snapshotsResult = await query<SnapshotByPeriodRow>(
		`SELECT DISTINCT ON (to_char(computed_at AT TIME ZONE 'UTC', 'YYYY-MM'))
			to_char(computed_at AT TIME ZONE 'UTC', 'YYYY-MM') AS period,
			entity_importance
		 FROM graph_snapshots
		 WHERE computed_at >= $1
		 ORDER BY to_char(computed_at AT TIME ZONE 'UTC', 'YYYY-MM') DESC, computed_at DESC`,
		[cutoff.toISOString()]
	);

	const snapshots = snapshotsResult.rows;

	if (snapshots.length === 0) {
		return {
			currentPeriodEnd: currentPeriodEnd.toISOString(),
			periodKind: 'month',
			sparse: true,
			series: []
		};
	}

	const currentSnapshot = snapshots[0];
	const currentEntities = Array.isArray(currentSnapshot.entity_importance)
		? currentSnapshot.entity_importance
		: [];

	const topEntityNames = [...currentEntities]
		.sort((a, b) => (b.pagerank_score ?? 0) - (a.pagerank_score ?? 0))
		.slice(0, ENTITY_CENTRALITY_TOP)
		.map((e) => e.name);

	const sparse = snapshots.length < ENTITY_CENTRALITY_PERIODS;

	if (topEntityNames.length === 0) {
		return {
			currentPeriodEnd: currentPeriodEnd.toISOString(),
			periodKind: 'month',
			sparse,
			series: []
		};
	}

	const byPeriod = new Map<string, SnapshotByPeriodRow['entity_importance']>();
	for (const row of snapshots) {
		byPeriod.set(row.period, Array.isArray(row.entity_importance) ? row.entity_importance : []);
	}
	const orderedPeriods = [...byPeriod.keys()].sort();

	const series = topEntityNames.map((entityName) => {
		const points: Array<{ period: string; centrality: number; mentions: number }> = [];
		for (const period of orderedPeriods) {
			const entities = byPeriod.get(period) ?? [];
			const found = entities.find((e) => e.name === entityName);
			if (!found) continue;
			points.push({
				period,
				centrality: typeof found.pagerank_score === 'number' ? found.pagerank_score : 0,
				mentions: typeof found.mention_count === 'number' ? found.mention_count : 0
			});
		}
		return { entityName, points };
	});

	return {
		currentPeriodEnd: currentPeriodEnd.toISOString(),
		periodKind: 'month',
		sparse,
		series
	};
}

// ---------------------------------------------------------------------------
// Four-pass trend report generation (Phase 4 contract)
//
// Pass 1 (sequential): marketSnapshot, developerSignals
// Pass 2: signalInterpretation (reads pass-1 text)
// Pass 3: executiveSummary + predictions (reads pass-1 + pass-2 text)
// Pass 4: supportingResources (ranks the aggregated research[] pool)
//
// Chart data is snapshotted into report_data.charts at persist time so
// rendering is deterministic across UI, email, and PDF surfaces.
// ---------------------------------------------------------------------------

function aggregateResearchPool(
	...sections: Array<{ research?: ResearchCitation[] } | undefined>
): ResearchCitation[] {
	const seen = new Set<string>();
	const pool: ResearchCitation[] = [];
	for (const section of sections) {
		if (!section?.research) continue;
		for (const entry of section.research) {
			if (!entry?.url || seen.has(entry.url)) continue;
			seen.add(entry.url);
			pool.push(entry);
		}
	}
	return pool;
}

async function runTrendReport(
	client: Awaited<ReturnType<typeof getClient>>,
	runId: string,
	rocketrideContext: RocketRideContext | null,
	operatorContext: OperatorContext,
	graphSnapshotId: string | null
): Promise<string | null> {
	await logRun(runId, 'info', 'trend-report', 'Starting trend report pipeline...');

	const systemPrompt = buildSystemPrompt(operatorContext);
	const sectionPrompts = buildSectionPrompts(operatorContext);

	// --- Gather inputs for pass 1 sections + chart snapshots ---
	await logRun(runId, 'info', 'trend-report', 'Querying databases for section data...');

	const [sourceDistribution, signalsInputs, snapshots, keywordDistribution, entityCentrality] =
		await Promise.all([
			gatherSourceDistribution(),
			gatherDeveloperSignalsInputs(),
			loadGraphSnapshots(),
			gatherKeywordDistribution(),
			gatherEntityCentrality()
		]);

	const topClusters = (snapshots.current?.topic_clusters ?? []).slice(0, 10);
	const topEntities = (snapshots.current?.entity_importance ?? []).slice(0, 20);
	const emergingEntities = computeEmergingEntities(snapshots.current, snapshots.weekAgo);

	// Phase 3: enrich the top 20 entities with historical context. Soft-fails
	// to plain entities if the analytics fetcher throws, so the report can
	// still ship without backfill data.
	const enrichedEntities: EntityWithHistory[] = await enrichEntitiesWithHistory(
		topEntities,
		fetchEntityHistory,
		{
			currentPeriodEnd: new Date(),
			periods: 12,
			periodKind: 'month',
			warn: (msg) => logRun(runId, 'warn', 'trend-report', msg)
		}
	);

	await logRun(
		runId,
		'info',
		'trend-report',
		`Graph snapshot fields: ${topClusters.length} clusters, ${enrichedEntities.length} entities, ${emergingEntities.length} emerging`
	);

	// Article count + source count for metadata
	const countResult = await query<{ count: string }>(
		"SELECT count(*) AS count FROM articles WHERE published_at > now() - interval '7 days'"
	);
	const articleCount = Number.parseInt(countResult.rows[0].count);
	const sourcesCount = sourceDistribution.length;

	await logRun(
		runId,
		'info',
		'trend-report',
		`Data gathered: ${articleCount} articles, ${enrichedEntities.length} entities, ${sourcesCount} sources, ${keywordDistribution.buckets.length} keyword buckets, ${entityCentrality.series.length} centrality series`
	);

	// --- Pass 1: marketSnapshot, developerSignals ---
	checkCancelled(runId);
	await logRun(
		runId,
		'info',
		'trend-report',
		'Pass 1: generating market_snapshot and developer_signals...'
	);

	const marketResponse = await runSection(
		client,
		runId,
		'marketSnapshot',
		sectionPrompts,
		systemPrompt,
		{
			entityImportance: enrichedEntities,
			sourceDistribution,
			topicClusters: topClusters,
			rocketrideContext
		}
	);
	const signalsResponse = await runSection(
		client,
		runId,
		'developerSignals',
		sectionPrompts,
		systemPrompt,
		{
			...signalsInputs,
			emergingEntities,
			rocketrideContext
		}
	);

	await logRun(runId, 'info', 'trend-report', 'Pass 1 complete.');

	// --- Pass 2: signal_interpretation (reads pass 1 text only) ---
	checkCancelled(runId);
	await logRun(runId, 'info', 'trend-report', 'Pass 2: generating signal_interpretation...');

	const interpretationResponse = await runSection(
		client,
		runId,
		'signalInterpretation',
		sectionPrompts,
		systemPrompt,
		{
			marketSnapshot: marketResponse.text,
			developerSignals: signalsResponse.text,
			rocketrideContext
		}
	);

	await logRun(runId, 'info', 'trend-report', 'Pass 2 complete.');

	// --- Pass 3: executive_summary + predictions (reads pass 1 + pass 2 text) ---
	checkCancelled(runId);
	await logRun(runId, 'info', 'trend-report', 'Pass 3: generating executive_summary...');

	const summaryResponse = await runSection(
		client,
		runId,
		'executiveSummary',
		sectionPrompts,
		systemPrompt,
		{
			marketSnapshot: marketResponse.text,
			developerSignals: signalsResponse.text,
			signalInterpretation: interpretationResponse.text
		}
	);

	await logRun(runId, 'info', 'trend-report', 'Pass 3 complete.');

	// --- Pass 4: supporting_resources (ranks aggregated research pool) ---
	checkCancelled(runId);
	await logRun(runId, 'info', 'trend-report', 'Pass 4: ranking supporting_resources...');

	const researchPool = aggregateResearchPool(
		marketResponse,
		signalsResponse,
		interpretationResponse
	);

	let supportingResources: SupportingResource[] = [];
	if (researchPool.length === 0) {
		await logRun(
			runId,
			'info',
			'trend-report',
			'Skipping supporting_resources pass: research pool is empty.'
		);
	} else {
		const resourcesResponse = await runSection(
			client,
			runId,
			'supportingResources',
			sectionPrompts,
			systemPrompt,
			{
				researchPool,
				rocketrideContext
			}
		);
		if (resourcesResponse.resources?.length) {
			supportingResources = resourcesResponse.resources.slice(0, 10);
		}
	}

	await logRun(
		runId,
		'info',
		'trend-report',
		`Pass 4 complete: ${supportingResources.length} supporting resources selected.`
	);

	// --- Assemble report_data with new shape ---
	const now = new Date();
	const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

	const charts: ReportCharts = {
		keywordDistribution,
		entityCentrality
	};

	const reportData: ReportData = {
		reportMetadata: {
			periodStart: weekAgo.toISOString(),
			periodEnd: now.toISOString(),
			sourcesCount,
			articleCount
		},
		sections: {
			executiveSummary: {
				text: summaryResponse.text,
				...(summaryResponse.predictions?.length ? { predictions: summaryResponse.predictions } : {})
			},
			marketSnapshot: {
				text: marketResponse.text,
				...(marketResponse.research?.length ? { research: marketResponse.research } : {})
			},
			developerSignals: {
				text: signalsResponse.text,
				...(signalsResponse.research?.length ? { research: signalsResponse.research } : {})
			},
			signalInterpretation: {
				text: interpretationResponse.text,
				interpretations: interpretationResponse.interpretations ?? [],
				...(interpretationResponse.research?.length
					? { research: interpretationResponse.research }
					: {})
			},
			supportingResources: {
				resources: supportingResources
			}
		},
		charts
	};

	await validateAndPersist(runId, 'trend-report.pipe', reportData);

	// --- Save report ---
	// graph_snapshot_id is persisted so reconstruction (e.g., --content-only
	// --report-id=<uuid>) can resolve the same intelligence view via the
	// context-builder without recomputing.
	const reportResult = await query<{ id: string }>(
		`INSERT INTO reports (run_id, period_start, period_end, report_data, article_count, graph_snapshot_id)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		[runId, weekAgo, now, JSON.stringify(reportData), articleCount, graphSnapshotId]
	);

	const reportId = reportResult.rows[0].id;
	await logRun(runId, 'success', 'trend-report', `Trend report saved: ${reportId}`);

	await query(
		`INSERT INTO notifications (type, title, message, link, reference_id)
		 VALUES ($1, $2, $3, $4, $5)`,
		[
			'report',
			'New Trend Report',
			`Report generated with ${articleCount} articles analyzed across ${sourcesCount} sources.`,
			`/reports/${reportId}`,
			reportId
		]
	);

	return reportId;
}

// ---------------------------------------------------------------------------
// Content drafts pipeline (Phase 5: two-pass, voice-aware)
//
// Pass 1 (`angle-picker.pipe`): selects 1 to N high-signal opportunities from
// the report's signalInterpretation and decides which platforms each angle
// targets. Voice profile only, no per-format samples.
//
// Pass 2 (`content-drafter.pipe`): writes the full content for every platform
// the picker selected, scoped to the voice samples for those platforms.
//
// The orchestration logic lives in `./lib/content-drafts-orchestrator.ts` so
// the two-pass flow can be tested without RocketRide or PostgreSQL. This
// wrapper supplies real wiring (RocketRide invoke, PostgreSQL insert,
// operator/voice loaders, run logger).
// ---------------------------------------------------------------------------

async function invokeContentPipeline(
	client: Awaited<ReturnType<typeof getClient>>,
	runId: string,
	pipeName: 'angle-picker.pipe' | 'content-drafter.pipe',
	payload: { system: string; user: string }
): Promise<unknown> {
	checkCancelled(runId);
	const pipePath = path.join(PIPELINES_DIR, pipeName);
	const { token } = await usePipeline(client, runId, pipePath);
	setActiveToken(runId, client, token);

	// The .pipe agents read a single `prompt` field at runtime: their static
	// instructions reference it by name. Concatenate the system directives
	// and the per-call user prompt into one body.
	const wirePayload = {
		prompt: `${payload.system}\n\n---\n\n${payload.user}`,
		data: {}
	};

	let response: unknown;
	try {
		response = await client.send(token, JSON.stringify(wirePayload), {}, 'application/json');
	} finally {
		await terminatePipeline(client, token);
	}

	const answers = (response as { answers?: unknown })?.answers ?? [];
	const first = Array.isArray(answers) ? answers[0] : answers;

	if (first && typeof first === 'object' && !Array.isArray(first)) {
		return first;
	}
	const str = typeof first === 'string' ? first : JSON.stringify(first ?? '{}');
	try {
		return extractJson<Record<string, unknown>>(str);
	} catch (parseErr) {
		const head = str.slice(0, 1500);
		const tail = str.length > 2100 ? str.slice(-600) : '';
		const preview = tail
			? `[${str.length} chars] ${head}\n...[middle elided]...\n${tail}`
			: `[${str.length} chars] ${str}`;
		const reason = parseErr instanceof Error ? parseErr.message : String(parseErr);
		await logRun(
			runId,
			'warn',
			'content-drafts',
			`Could not parse ${pipeName} answer (${reason}). Raw: ${preview}`
		);
		return {};
	}
}

async function persistContentDraftRow(row: ContentDraftRow): Promise<void> {
	await query(
		`INSERT INTO content_drafts
		   (run_id, report_id, platform, content_type, body, angle, opportunity_signal, metadata)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		[
			row.runId,
			row.reportId,
			row.platform,
			row.contentType,
			row.body,
			row.angle,
			row.opportunitySignal,
			JSON.stringify(row.metadata)
		]
	);
}

async function runContentDrafts(
	client: Awaited<ReturnType<typeof getClient>>,
	runId: string,
	reportId: string,
	reportData: ReportData
): Promise<number> {
	await logRun(runId, 'info', 'content-drafts', 'Starting content drafts pipeline...');

	const result = await orchestrateContentDrafts(
		{
			loadOperator: loadOperatorContext,
			loadVoice: loadVoiceContext,
			invokePipeline: (innerRunId, pipeName, payload) =>
				invokeContentPipeline(client, innerRunId, pipeName, payload),
			insertDraft: persistContentDraftRow,
			log: (innerRunId, level, stage, message) => logRun(innerRunId, level, stage, message)
		},
		{ runId, reportId, reportData }
	);

	if (result.draftCount > 0) {
		await query(
			`INSERT INTO notifications (type, title, message, link, reference_id)
			 VALUES ($1, $2, $3, $4, $5)`,
			[
				'drafts',
				'Content Drafts Ready',
				`${result.draftCount} platform drafts generated across ${result.angleCount} angle(s).`,
				'/drafts',
				reportId
			]
		);
	}

	return result.draftCount;
}

/**
 * Run only the content-drafts pipeline against an existing report row.
 *
 * Use case: re-run drafts for a previously generated report without
 * regenerating the report itself (e.g., after iterating on prompts or voice
 * samples). Driven by `pnpm run pipeline -- --content-only --report-id=<id>`.
 *
 * @param reportId Existing `reports.id` UUID. Throws if the row is missing.
 * @param trigger Run trigger label written to the `runs` row.
 * @returns The new run id, the report id, and the count of drafts persisted.
 */
export async function runContentDraftsForReport(
	reportId: string,
	trigger: 'scheduled' | 'manual' = 'manual'
): Promise<{ runId: string; reportId: string; draftCount: number }> {
	const reportRow = await query<{ report_data: ReportData }>(
		'SELECT report_data FROM reports WHERE id = $1',
		[reportId]
	);
	if (reportRow.rows.length === 0) {
		throw new Error(`Report not found: ${reportId}`);
	}
	const reportData = reportRow.rows[0].report_data;

	let runId: string;
	try {
		const runResult = await query<{ id: string }>(
			"INSERT INTO runs (trigger, run_type) VALUES ($1, 'pipeline') RETURNING id",
			[trigger]
		);
		runId = runResult.rows[0].id;
	} catch (err: unknown) {
		if (
			err &&
			typeof err === 'object' &&
			'code' in err &&
			(err as { code: string }).code === '23505'
		) {
			throw new Error('Another pipeline is already running. Try again once it completes.');
		}
		throw err;
	}

	let client: Awaited<ReturnType<typeof getClient>> | null = null;
	try {
		await logRun(
			runId,
			'info',
			'init',
			`Content-only pipeline run started for report ${reportId} (trigger: ${trigger})`
		);

		// Operator context must be configured even for content-only runs.
		try {
			loadOperatorContext();
		} catch (err) {
			if (err instanceof OperatorContextNotConfiguredError) {
				const message =
					'Pulsar pipeline requires .context/ configuration. Run pnpm setup to configure.';
				await logRun(runId, 'error', 'init', message);
			}
			throw err;
		}

		client = await getClient();
		await logRun(runId, 'info', 'init', 'Connected to RocketRide');

		const draftCount = await runContentDrafts(client, runId, reportId, reportData);

		await query("UPDATE runs SET completed_at = now(), status = 'complete' WHERE id = $1", [runId]);
		await logRun(runId, 'success', 'complete', 'Content-only pipeline complete');

		activeRuns.delete(runId);
		return { runId, reportId, draftCount };
	} catch (err) {
		const cancelled = activeRuns.get(runId)?.aborted;
		activeRuns.delete(runId);
		const status = cancelled ? 'cancelled' : 'failed';
		const message = cancelled ? 'Run was cancelled by user' : String(err);
		await logRun(runId, 'error', 'fatal', message);
		await query('UPDATE runs SET completed_at = now(), status = $1, error_log = $2 WHERE id = $3', [
			status,
			message,
			runId
		]);
		if (!cancelled) throw err;
		return { runId, reportId, draftCount: 0 };
	}
}

// ---------------------------------------------------------------------------
// Orchestration entry point
// ---------------------------------------------------------------------------

export async function runAllPipelines(trigger: 'scheduled' | 'manual' = 'scheduled') {
	// Atomic DB-level lock: the unique partial index on (run_type) WHERE status = 'running'
	// ensures only one pipeline can be active at a time. If another is running, the INSERT
	// fails with a unique violation (23505) and we skip.
	let runId: string;
	try {
		const runResult = await query<{ id: string }>(
			"INSERT INTO runs (trigger, run_type) VALUES ($1, 'pipeline') RETURNING id",
			[trigger]
		);
		runId = runResult.rows[0].id;
	} catch (err: unknown) {
		if (
			err &&
			typeof err === 'object' &&
			'code' in err &&
			(err as { code: string }).code === '23505'
		) {
			console.log('[Pipeline] Skipped: another pipeline is already running.');
			return { runId: null, reportId: null };
		}
		throw err;
	}

	let client: Awaited<ReturnType<typeof getClient>> | null = null;
	try {
		await logRun(runId, 'info', 'init', `Pipeline run started (trigger: ${trigger})`);

		// Load operator context once. Pipelines refuse to start without it.
		let operatorContext: OperatorContext;
		try {
			operatorContext = loadOperatorContext();
		} catch (err) {
			if (err instanceof OperatorContextNotConfiguredError) {
				const message =
					'Pulsar pipeline requires .context/ configuration. Run pnpm setup to configure.';
				await logRun(runId, 'error', 'init', message);
			}
			throw err;
		}

		client = await getClient();
		await logRun(runId, 'info', 'init', 'Connected to RocketRide');

		// Compute graph snapshot first (deterministic GDS algorithms over Neo4j)
		const snapshotId = await runGraphSnapshot(client, runId);
		if (!snapshotId) {
			await warnIfSnapshotStale(runId);
		}

		// Fetch RocketRide product context once for both pipelines
		await logRun(runId, 'info', 'context', 'Fetching RocketRide product context...');
		const rocketrideContext = await fetchRocketRideContext(runId);
		if (rocketrideContext) {
			await validateAndPersist(runId, 'rocketride-context.pipe', rocketrideContext);
		}
		await logRun(
			runId,
			rocketrideContext ? 'info' : 'warn',
			'context',
			rocketrideContext
				? `RocketRide context fetched (${rocketrideContext.fetched_at})`
				: 'Failed to fetch RocketRide context, proceeding without it'
		);

		// Sequential pipeline execution: trend report, predictions extraction, content drafts
		const reportId = await runTrendReport(
			client,
			runId,
			rocketrideContext,
			operatorContext,
			snapshotId
		);
		let draftCount = 0;

		if (reportId) {
			// Phase D.2: extract time-bounded predictions from the finished report
			const reportRow = await query<{ report_data: ReportData }>(
				'SELECT report_data FROM reports WHERE id = $1',
				[reportId]
			);
			if (reportRow.rows.length > 0) {
				const reportData = reportRow.rows[0].report_data;
				await extractPredictions(runId, reportId, reportData);
				draftCount = await runContentDrafts(client, runId, reportId, reportData);
			}
		}

		// Phase D.1: LLM-graded evaluations (Haiku) over the report and each draft
		let evaluationSummary = null;
		if (reportId) {
			try {
				evaluationSummary = await runEvaluations(client, runId, reportId);
			} catch (evalErr) {
				await logRun(runId, 'warn', 'evaluations', `Evaluations failed (soft fail): ${evalErr}`);
			}
		}

		// Send report email last so it can include eval scores
		if (reportId) {
			try {
				await sendReportEmail(reportId, evaluationSummary ?? undefined);
				await logRun(runId, 'info', 'email', 'Report email sent');
			} catch (emailErr) {
				await logRun(runId, 'warn', 'email', `Failed to send email: ${emailErr}`);
			}
		}

		await query("UPDATE runs SET completed_at = now(), status = 'complete' WHERE id = $1", [runId]);

		await logRun(runId, 'success', 'complete', 'All pipelines complete');

		activeRuns.delete(runId);
		return { runId, reportId };
	} catch (err) {
		const cancelled = activeRuns.get(runId)?.aborted;
		activeRuns.delete(runId);
		const status = cancelled ? 'cancelled' : 'failed';
		const message = cancelled ? 'Run was cancelled by user' : String(err);
		await logRun(runId, 'error', 'fatal', message);
		await query('UPDATE runs SET completed_at = now(), status = $1, error_log = $2 WHERE id = $3', [
			status,
			message,
			runId
		]);
		if (!cancelled) throw err;
		return { runId, reportId: null };
	}
}
