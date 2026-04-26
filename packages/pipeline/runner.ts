import { getClient, disconnectClient } from './lib/rocketride.js';
import { sendReportEmail } from './notify.js';
import { extractJson } from './lib/parse-json.js';
import { SECTION_PROMPTS } from './trend-report-prompts.js';
import { query } from '@pulsar/shared/db/postgres';
import { getSession } from '@pulsar/shared/db/neo4j';
import { logRun } from '@pulsar/shared/run-logger';
import type {
	ReportData,
	MarketLandscapeData,
	TechnologyTrendsData,
	DeveloperSignalsData,
	ResearchCitation,
} from '@pulsar/shared/types';
import path from 'path';
import { fileURLToPath } from 'url';

const PIPELINES_DIR = path.resolve(fileURLToPath(import.meta.url), '../pipelines');
const TREND_REPORT_PIPE = path.join(PIPELINES_DIR, 'trend-report.pipe');

// ---------------------------------------------------------------------------
// RocketRide package context (fetched once per run for positioning data)
// ---------------------------------------------------------------------------

interface PackageContext {
	label: string;
	url: string;
	name: string;
	version: string;
	summary: string;
	stats?: Record<string, number>;
}

type PackageFetcher = () => Promise<PackageContext | null>;

function pypi(label: string, pkg: string): PackageFetcher {
	return async () => {
		const res = await fetch(`https://pypi.org/pypi/${pkg}/json`, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return null;
		const info = (await res.json()).info;
		return { label, url: `https://pypi.org/project/${pkg}/`, name: info.name, version: info.version, summary: info.summary };
	};
}

function npm(label: string, pkg: string): PackageFetcher {
	return async () => {
		const res = await fetch(`https://registry.npmjs.org/${pkg}`, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return null;
		const data = await res.json();
		const latest = data['dist-tags']?.latest ?? '';
		const meta = latest ? data.versions?.[latest] : null;
		return { label, url: `https://www.npmjs.com/package/${pkg}`, name: data.name, version: latest, summary: meta?.description ?? data.description ?? '' };
	};
}

function vscMarketplace(label: string, extensionId: string): PackageFetcher {
	return async () => {
		const res = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Accept': 'application/json;api-version=6.0-preview.1' },
			body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: extensionId }] }], flags: 914 }),
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return null;
		const ext = (await res.json()).results?.[0]?.extensions?.[0];
		if (!ext) return null;
		const stats: Record<string, number> = {};
		for (const s of ext.statistics ?? []) stats[s.statisticName] = s.value;
		return { label, url: `https://marketplace.visualstudio.com/items?itemName=${extensionId}`, name: ext.displayName, version: ext.versions?.[0]?.version ?? '', summary: ext.shortDescription ?? '', stats };
	};
}

function openVsx(label: string, namespace: string, name: string): PackageFetcher {
	return async () => {
		const res = await fetch(`https://open-vsx.org/api/${namespace}/${name}`, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return null;
		const data = await res.json();
		return { label, url: `https://open-vsx.org/extension/${namespace}/${name}`, name: data.displayName ?? data.name, version: data.version, summary: data.description ?? '' };
	};
}

const ROCKETRIDE_PACKAGES: PackageFetcher[] = [
	pypi('rocketride (Python SDK)', 'rocketride'),
	pypi('rocketride-mcp (MCP server)', 'rocketride-mcp'),
	npm('rocketride (TypeScript SDK)', 'rocketride'),
	vscMarketplace('rocketride (VS Code extension)', 'RocketRide.rocketride'),
	openVsx('rocketride (Open VSX extension)', 'RocketRide', 'rocketride'),
];

async function fetchPackageContext(): Promise<PackageContext[]> {
	const settled = await Promise.allSettled(ROCKETRIDE_PACKAGES.map((fn) => fn()));
	return settled
		.filter((r): r is PromiseFulfilledResult<PackageContext | null> => r.status === 'fulfilled' && r.value !== null)
		.map((r) => r.value!);
}

// ---------------------------------------------------------------------------
// Pipeline token tracking (for cancellation)
// ---------------------------------------------------------------------------

const activeRuns = new Map<string, { client: Awaited<ReturnType<typeof getClient>>; token: string; aborted: boolean }>();

export function cancelRun(runId: string): boolean {
	const active = activeRuns.get(runId);
	if (!active) return false;
	active.aborted = true;
	active.client.terminate(active.token).catch(() => {});
	return true;
}

export function isRunCancelled(runId: string): boolean {
	return activeRuns.get(runId)?.aborted === true;
}

function setActiveToken(runId: string, client: Awaited<ReturnType<typeof getClient>>, token: string) {
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
}

async function runSection(
	client: Awaited<ReturnType<typeof getClient>>,
	runId: string,
	sectionKey: string,
	data: unknown,
): Promise<SectionResponse> {
	checkCancelled(runId);

	const payload = {
		prompt: SECTION_PROMPTS[sectionKey],
		data,
	};

	const result = await client.use({ filepath: TREND_REPORT_PIPE });
	const token = result.token;
	setActiveToken(runId, client, token);

	const response = await client.send(
		token,
		JSON.stringify(payload),
		{},
		'application/json',
	);

	await client.terminate(token);

	const raw = response?.answers?.[0];

	// If RocketRide already parsed the response into an object with a text field, use it
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		const obj = raw as Record<string, unknown>;
		if (typeof obj.text === 'string') {
			return {
				text: obj.text,
				...(Array.isArray(obj.research) ? { research: obj.research as ResearchCitation[] } : {}),
			};
		}
	}

	// Otherwise parse from string (handles JSON, Python-style dicts, markdown fences)
	const str = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '{}');
	try {
		return extractJson<SectionResponse>(str);
	} catch {
		return { text: str.trim() || 'Analysis could not be generated for this section.' };
	}
}

// ---------------------------------------------------------------------------
// Data gathering: Neo4j + PostgreSQL queries
// ---------------------------------------------------------------------------

async function gatherMarketLandscapeData(): Promise<MarketLandscapeData> {
	const session = getSession();
	try {
		// Entity mentions (7d)
		const entitiesResult = await session.run(
			`MATCH (e:Entity)<-[:MENTIONS]-(a:Article)
			 WHERE a.publishedAt > datetime() - duration('P7D')
			 RETURN e.name AS name, e.type AS type, count(a) AS mentionCount
			 ORDER BY mentionCount DESC LIMIT 20`,
		);
		const entities = entitiesResult.records.map((r) => ({
			name: r.get('name'),
			type: r.get('type'),
			mentionCount: typeof r.get('mentionCount') === 'object'
				? r.get('mentionCount').toNumber()
				: r.get('mentionCount'),
		}));

		// Technologies: entities filtered to tool/model/language
		const technologies = entities
			.filter((e) => ['tool', 'model', 'language'].includes(e.type))
			.slice(0, 10);

		// Source distribution (7d)
		const sourceResult = await session.run(
			`MATCH (a:Article)-[:FROM_SOURCE]->(s:Source)
			 WHERE a.publishedAt > datetime() - duration('P7D')
			 RETURN s.name AS source, count(a) AS articleCount
			 ORDER BY articleCount DESC`,
		);
		const sourceDistribution = sourceResult.records.map((r) => ({
			source: r.get('source'),
			articleCount: typeof r.get('articleCount') === 'object'
				? r.get('articleCount').toNumber()
				: r.get('articleCount'),
		}));

		return { entities, technologies, sourceDistribution };
	} finally {
		await session.close();
	}
}

async function gatherTechnologyTrendsData(): Promise<TechnologyTrendsData> {
	const session = getSession();
	try {
		// Trending topics (7d)
		const topicsResult = await session.run(
			`MATCH (t:Topic)
			 WHERE t.trendScore > 0
			 RETURN t.name AS topic, t.trendScore AS trendScore, t.category AS category
			 ORDER BY t.trendScore DESC LIMIT 20`,
		);
		const topics = topicsResult.records.map((r) => ({
			topic: r.get('topic'),
			trendScore: r.get('trendScore'),
			sentiment: 'neutral',
			articleCount: 0,
			sparkline: [] as number[],
		}));

		// Topic co-occurrence
		const coOccurrenceResult = await session.run(
			`MATCH (t1:Topic)-[r:RELATED_TO]-(t2:Topic)
			 WHERE r.weight > 2
			 RETURN t1.name AS topicA, t2.name AS topicB, r.weight AS count
			 ORDER BY count DESC LIMIT 15`,
		);
		const topicCoOccurrence = coOccurrenceResult.records.map((r) => ({
			topicA: r.get('topicA'),
			topicB: r.get('topicB'),
			count: typeof r.get('count') === 'object'
				? r.get('count').toNumber()
				: r.get('count'),
		}));

		await session.close();

		// Keyword frequency from PostgreSQL (7d)
		const keywordResult = await query<{ keyword: string; count: string }>(
			`SELECT unnest(topic_tags) AS keyword, count(*) AS count
			 FROM articles
			 WHERE published_at > now() - interval '7 days'
			 GROUP BY keyword ORDER BY count DESC LIMIT 20`,
		);
		const trendingKeywords7d = keywordResult.rows.map((r) => ({
			keyword: r.keyword,
			count7d: parseInt(r.count),
		}));

		// 30d keyword counts
		const keyword30dResult = await query<{ keyword: string; count: string }>(
			`SELECT unnest(topic_tags) AS keyword, count(*) AS count
			 FROM articles
			 WHERE published_at > now() - interval '30 days'
			 GROUP BY keyword ORDER BY count DESC LIMIT 30`,
		);
		const keyword30dMap = new Map(
			keyword30dResult.rows.map((r) => [r.keyword, parseInt(r.count)]),
		);

		const keywords = trendingKeywords7d.map((k) => ({
			...k,
			count30d: keyword30dMap.get(k.keyword) || k.count7d,
			delta:
				k.count7d /
					Math.max(1, ((keyword30dMap.get(k.keyword) || k.count7d) - k.count7d) / 3 || 1) -
				1,
		}));

		// Velocity outliers: keywords with delta > 0.5
		const velocityOutliers = keywords
			.filter((k) => k.delta > 0.5)
			.slice(0, 10)
			.map((k) => ({
				topic: k.keyword,
				spike: k.count7d,
				baseline: k.count30d / 4,
			}));

		// Emerging topics from Neo4j (recently appeared)
		const emergingSession = getSession();
		let emergingTopics: string[] = [];
		try {
			const emergingResult = await emergingSession.run(
				`MATCH (t:Topic)
				 WHERE t.firstSeen > datetime() - duration('P14D') AND t.trendScore > 1
				 RETURN t.name AS topic
				 ORDER BY t.trendScore DESC LIMIT 10`,
			);
			emergingTopics = emergingResult.records.map((r) => r.get('topic'));
		} finally {
			await emergingSession.close();
		}

		return { keywords, topics, velocityOutliers, topicCoOccurrence, emergingTopics };
	} finally {
		// session already closed above before PG queries
	}
}

async function gatherDeveloperSignalsData(): Promise<DeveloperSignalsData> {
	// Sentiment breakdown from PostgreSQL
	const sentimentResult = await query<{ sentiment: string; count: string }>(
		`SELECT COALESCE(sentiment, 'neutral') AS sentiment, count(*) AS count
		 FROM articles
		 WHERE published_at > now() - interval '7 days'
		 GROUP BY sentiment`,
	);
	const sentimentBreakdown = { positive: 0, negative: 0, neutral: 0 };
	for (const row of sentimentResult.rows) {
		const key = row.sentiment as keyof typeof sentimentBreakdown;
		if (key in sentimentBreakdown) {
			sentimentBreakdown[key] = parseInt(row.count);
		}
	}

	// Top authors from Neo4j
	const session = getSession();
	let topAuthors: DeveloperSignalsData['topAuthors'] = [];
	try {
		const authorsResult = await session.run(
			`MATCH (au:Author)<-[:AUTHORED_BY]-(a:Article)
			 WHERE a.publishedAt > datetime() - duration('P7D')
			 RETURN au.handle AS handle, au.platform AS platform, count(a) AS articleCount
			 ORDER BY articleCount DESC LIMIT 10`,
		);
		topAuthors = authorsResult.records.map((r) => ({
			handle: r.get('handle'),
			platform: r.get('platform') || 'unknown',
			articleCount: typeof r.get('articleCount') === 'object'
				? r.get('articleCount').toNumber()
				: r.get('articleCount'),
		}));
	} finally {
		await session.close();
	}

	// Top discussions (highest engagement articles)
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
		 ORDER BY comment_count DESC LIMIT 10`,
	);
	const topDiscussions = discussionsResult.rows.map((r) => ({
		title: r.title,
		url: r.url,
		commentCount: parseInt(r.comment_count),
		source: r.source_name,
	}));

	return { sentimentBreakdown, topAuthors, topDiscussions };
}

// ---------------------------------------------------------------------------
// Three-pass trend report generation
// ---------------------------------------------------------------------------

async function runTrendReport(
	client: Awaited<ReturnType<typeof getClient>>,
	runId: string,
): Promise<string | null> {
	await logRun(runId, 'info', 'trend-report', 'Starting trend report pipeline...');

	// --- Gather data for all three pass-1 sections ---
	await logRun(runId, 'info', 'trend-report', 'Querying databases for section data...');

	const [marketData, techData, signalsData, rocketridePackages] = await Promise.all([
		gatherMarketLandscapeData(),
		gatherTechnologyTrendsData(),
		gatherDeveloperSignalsData(),
		fetchPackageContext(),
	]);

	// Article count + source count for metadata
	const countResult = await query<{ count: string }>(
		"SELECT count(*) AS count FROM articles WHERE published_at > now() - interval '7 days'",
	);
	const articleCount = parseInt(countResult.rows[0].count);
	const sourcesCount = marketData.sourceDistribution.length;

	await logRun(
		runId,
		'info',
		'trend-report',
		`Data gathered: ${articleCount} articles, ${techData.topics.length} topics, ${marketData.entities.length} entities, ${sourcesCount} sources`,
	);

	// --- Pass 1: sections 1, 2, 3 (sequential — RocketRide runs one pipeline at a time) ---
	checkCancelled(runId);
	await logRun(runId, 'info', 'trend-report', 'Pass 1: generating market_landscape, technology_trends, developer_signals...');

	const marketResponse = await runSection(client, runId, 'marketLandscape', { ...marketData, rocketridePackages });
	const techResponse = await runSection(client, runId, 'technologyTrends', { ...techData, rocketridePackages });
	const signalsResponse = await runSection(client, runId, 'developerSignals', { ...signalsData, rocketridePackages });

	await logRun(runId, 'info', 'trend-report', 'Pass 1 complete.');

	// --- Pass 2: content_recommendations (reads pass 1 text only) ---
	checkCancelled(runId);
	await logRun(runId, 'info', 'trend-report', 'Pass 2: generating content_recommendations...');

	const pass2Input = {
		marketLandscape: marketResponse.text,
		technologyTrends: techResponse.text,
		developerSignals: signalsResponse.text,
		rocketridePackages,
	};
	const contentResponse = await runSection(client, runId, 'contentRecommendations', pass2Input);

	await logRun(runId, 'info', 'trend-report', 'Pass 2 complete.');

	// --- Pass 3: executive_summary (reads all four text outputs) ---
	checkCancelled(runId);
	await logRun(runId, 'info', 'trend-report', 'Pass 3: generating executive_summary...');

	const pass3Input = {
		marketLandscape: marketResponse.text,
		technologyTrends: techResponse.text,
		developerSignals: signalsResponse.text,
		contentRecommendations: contentResponse.text,
	};
	const summaryResponse = await runSection(client, runId, 'executiveSummary', pass3Input);

	await logRun(runId, 'info', 'trend-report', 'Pass 3 complete.');

	// --- Assemble report_data ---
	const now = new Date();
	const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

	const reportData: ReportData = {
		reportMetadata: {
			periodStart: weekAgo.toISOString(),
			periodEnd: now.toISOString(),
			sourcesCount,
			articleCount,
		},
		sections: {
			marketLandscape: {
				data: marketData,
				text: marketResponse.text,
				...(marketResponse.research?.length ? { research: marketResponse.research } : {}),
			},
			technologyTrends: {
				data: techData,
				text: techResponse.text,
				...(techResponse.research?.length ? { research: techResponse.research } : {}),
			},
			developerSignals: {
				data: signalsData,
				text: signalsResponse.text,
				...(signalsResponse.research?.length ? { research: signalsResponse.research } : {}),
			},
			contentRecommendations: {
				text: contentResponse.text,
				...(contentResponse.research?.length ? { research: contentResponse.research } : {}),
			},
			executiveSummary: {
				text: summaryResponse.text,
			},
		},
	};

	// --- Save report ---
	const reportResult = await query<{ id: string }>(
		`INSERT INTO reports (run_id, period_start, period_end, report_data, article_count)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		[runId, weekAgo, now, JSON.stringify(reportData), articleCount],
	);

	const reportId = reportResult.rows[0].id;
	await logRun(runId, 'success', 'trend-report', `Trend report saved: ${reportId}`);

	try {
		await sendReportEmail(reportId);
		await logRun(runId, 'info', 'email', 'Report email sent');
	} catch (emailErr) {
		await logRun(runId, 'warn', 'email', `Failed to send email: ${emailErr}`);
	}

	await query(
		`INSERT INTO notifications (type, title, message, link, reference_id)
		 VALUES ($1, $2, $3, $4, $5)`,
		[
			'report',
			'New Trend Report',
			`Report generated with ${articleCount} articles analyzed across ${sourcesCount} sources.`,
			`/reports/${reportId}`,
			reportId,
		],
	);

	return reportId;
}

// ---------------------------------------------------------------------------
// Content drafts pipeline (unchanged structure, updated field paths)
// ---------------------------------------------------------------------------

const DRAFT_PLATFORMS = ['hashnode', 'medium', 'devto', 'hackernews', 'linkedin', 'twitter', 'discord'];

async function runContentDrafts(
	client: Awaited<ReturnType<typeof getClient>>,
	runId: string,
	reportId: string,
) {
	await logRun(runId, 'info', 'content-drafts', 'Starting content drafts pipeline...');

	// Get latest report
	const reportResult = await query<{ report_data: ReportData }>(
		'SELECT report_data FROM reports WHERE id = $1',
		[reportId],
	);
	const reportData = reportResult.rows[0].report_data;
	const sections = reportData.sections;

	// Get top 10 articles from last 24h
	const articlesResult = await query<{ title: string; url: string; summary: string; source_name: string }>(
		`SELECT title, url, summary, source_name FROM articles
		 WHERE published_at > now() - interval '24 hours' AND enriched_at IS NOT NULL
		 ORDER BY score DESC NULLS LAST LIMIT 10`,
	);

	await logRun(runId, 'info', 'content-drafts', `Using ${articlesResult.rows.length} top articles for draft generation`);

	// Fetch RocketRide package context (same as trend report)
	const rocketridePackages = await fetchPackageContext();

	// Content-drafts receives the content_recommendations text and supporting context
	const payload = {
		report: {
			executiveSummary: sections.executiveSummary.text,
			contentRecommendations: sections.contentRecommendations.text,
			trendingTopics: sections.technologyTrends.data.topics.slice(0, 5),
			emergingTopics: sections.technologyTrends.data.emergingTopics,
		},
		topArticles: articlesResult.rows,
		rocketridePackages,
	};

	// Send to RocketRide
	checkCancelled(runId);
	await logRun(runId, 'info', 'content-drafts', 'Sending data to AI for draft generation...');

	const result = await client.use({
		filepath: path.join(PIPELINES_DIR, 'content-drafts.pipe'),
	});
	const token = result.token;
	setActiveToken(runId, client, token);

	const response = await client.send(
		token,
		JSON.stringify(payload),
		{},
		'application/json',
	);

	await client.terminate(token);

	// Parse JSON responses from fan-out: each drafter returns {"platform": "content"}
	// response.answers is an array with one entry per drafter agent
	const answers = response?.answers ?? [];
	const drafts: Record<string, string> = {};

	for (const answer of Array.isArray(answers) ? answers : [answers]) {
		// If RocketRide already parsed the answer into an object, extract platform keys
		if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
			const obj = answer as Record<string, unknown>;
			for (const p of DRAFT_PLATFORMS) {
				if (typeof obj[p] === 'string') drafts[p] = obj[p] as string;
			}
			continue;
		}

		// Otherwise extract JSON from string
		const str = typeof answer === 'string' ? answer : JSON.stringify(answer ?? '{}');
		try {
			const parsed = extractJson<Record<string, string>>(str);
			for (const p of DRAFT_PLATFORMS) {
				if (typeof parsed[p] === 'string') drafts[p] = parsed[p];
			}
		} catch {
			await logRun(runId, 'warn', 'content-drafts', `Could not parse drafter answer. Raw (first 300 chars): ${str.slice(0, 300)}`);
		}
	}

	// Save each draft
	const platformMapping: Record<string, { contentType: string }> = {
		hashnode: { contentType: 'article' },
		medium: { contentType: 'article' },
		devto: { contentType: 'article' },
		hackernews: { contentType: 'article' },
		linkedin: { contentType: 'social' },
		twitter: { contentType: 'social' },
		discord: { contentType: 'social' },
	};

	let savedCount = 0;
	for (const [platform, body] of Object.entries(drafts)) {
		if (!platformMapping[platform]) continue;
		const content = typeof body === 'string' ? body : JSON.stringify(body);
		if (!content || content.length < 10) {
			await logRun(runId, 'warn', 'content-drafts', `Skipped ${platform}: empty or too short`);
			continue;
		}

		try {
			await query(
				`INSERT INTO content_drafts (run_id, report_id, platform, content_type, body)
				 VALUES ($1, $2, $3, $4, $5)`,
				[runId, reportId, platform, platformMapping[platform].contentType, content],
			);
			savedCount++;
		} catch (err) {
			await logRun(runId, 'error', 'content-drafts', `Failed to save ${platform} draft: ${err}`);
		}
	}

	await logRun(runId, 'success', 'content-drafts', `Content drafts saved: ${savedCount} of ${Object.keys(drafts).length} platforms`);

	if (savedCount > 0) {
		await query(
			`INSERT INTO notifications (type, title, message, link, reference_id)
			 VALUES ($1, $2, $3, $4, $5)`,
			[
				'drafts',
				'Content Drafts Ready',
				`${savedCount} platform drafts generated and ready for review.`,
				'/drafts',
				reportId,
			],
		);
	}

	return savedCount;
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
			[trigger],
		);
		runId = runResult.rows[0].id;
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
			console.log('[Pipeline] Skipped — another pipeline is already running.');
			return { runId: null, reportId: null };
		}
		throw err;
	}

	let client: Awaited<ReturnType<typeof getClient>> | null = null;
	try {
		await logRun(runId, 'info', 'init', `Pipeline run started (trigger: ${trigger})`);
		client = await getClient();
		await logRun(runId, 'info', 'init', 'Connected to RocketRide');

		// Sequential pipeline execution: trend report then content drafts
		const reportId = await runTrendReport(client, runId);
		let draftCount = 0;

		if (reportId) {
			draftCount = await runContentDrafts(client, runId, reportId);
		}

		await query(
			"UPDATE runs SET completed_at = now(), status = 'complete' WHERE id = $1",
			[runId],
		);

		await logRun(runId, 'success', 'complete', 'All pipelines complete');

		activeRuns.delete(runId);
		return { runId, reportId };
	} catch (err) {
		const cancelled = activeRuns.get(runId)?.aborted;
		activeRuns.delete(runId);
		const status = cancelled ? 'cancelled' : 'failed';
		const message = cancelled ? 'Run was cancelled by user' : String(err);
		await logRun(runId, 'error', 'fatal', message);
		await query(
			'UPDATE runs SET completed_at = now(), status = $1, error_log = $2 WHERE id = $3',
			[status, message, runId],
		);
		if (!cancelled) throw err;
		return { runId, reportId: null };
	}
}
