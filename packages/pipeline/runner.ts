import { getClient, disconnectClient } from "./lib/rocketride.js";
import { sendReportEmail } from "./notify.js";
import { query } from "@pulsar/shared/db/postgres";
import { getSession } from "@pulsar/shared/db/neo4j";
import { logRun } from "@pulsar/shared/run-logger";
import { extractJson } from "./lib/parse-json.js";
import type { ReportData } from "@pulsar/shared/types";
import path from "path";
import { fileURLToPath } from "url";

const PIPELINES_DIR = path.resolve(fileURLToPath(import.meta.url), "../pipelines");

// JSON converter pipeline for post-processing non-JSON LLM responses
let jsonConverterToken: string | null = null;

async function ensureJsonConverter(client: Awaited<ReturnType<typeof getClient>>): Promise<string> {
  if (jsonConverterToken) return jsonConverterToken;
  const result = await client.use({
    filepath: path.join(PIPELINES_DIR, "json-converter.pipe"),
  });
  jsonConverterToken = result.token;
  return jsonConverterToken;
}

async function postProcessToJson<T = Record<string, unknown>>(
  client: Awaited<ReturnType<typeof getClient>>,
  rawResponse: string,
  schema: string,
): Promise<T> {
  // First try direct extraction
  try {
    return extractJson<T>(rawResponse);
  } catch {
    // Fall through to post-processing
  }

  // Use the JSON converter pipeline (direct LLM, no agent)
  const token = await ensureJsonConverter(client);
  const prompt = `Extract the data from the following text and return it as a JSON object matching this schema:\n${schema}\n\nText to convert:\n${rawResponse.slice(0, 4000)}`;
  const response = await client.send(token, prompt);

  if (response?.answers && response.answers.length > 0) {
    const answer = response.answers[0];
    const parsed = typeof answer === "string" ? answer : JSON.stringify(answer);
    return extractJson<T>(parsed);
  }

  throw new SyntaxError(`Post-processing failed to extract JSON from: ${rawResponse.slice(0, 100)}...`);
}

async function cleanupJsonConverter(client: Awaited<ReturnType<typeof getClient>>) {
  if (jsonConverterToken) {
    await client.terminate(jsonConverterToken).catch(() => {});
    jsonConverterToken = null;
  }
}

// Track active pipeline tokens per run for cancellation
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
  if (existing?.aborted) throw new Error("Run was cancelled");
  activeRuns.set(runId, { client, token, aborted: existing?.aborted ?? false });
}

function checkCancelled(runId: string) {
  if (activeRuns.get(runId)?.aborted) throw new Error("Run was cancelled");
}

async function runTrendReport(
  client: Awaited<ReturnType<typeof getClient>>,
  runId: string,
): Promise<string | null> {
  await logRun(runId, "info", "trend-report", "Starting trend report pipeline...");

  // Gather trend data from Neo4j
  const session = getSession();
  let trendData: Record<string, unknown>;

  try {
    await logRun(runId, "info", "trend-report", "Querying Neo4j for trend data...");

    // Trending topics (7d)
    const topicsResult = await session.run(
      `MATCH (t:Topic)
       WHERE t.trendScore > 0
       RETURN t.name AS topic, t.trendScore AS trendScore, t.category AS category
       ORDER BY t.trendScore DESC LIMIT 20`,
    );
    const trendingTopics = topicsResult.records.map((r) => ({
      topic: r.get("topic"),
      trendScore: r.get("trendScore"),
      category: r.get("category"),
    }));

    // Entity mentions
    const entitiesResult = await session.run(
      `MATCH (e:Entity)<-[:MENTIONS]-(a:Article)
       WHERE a.publishedAt > datetime() - duration('P7D')
       RETURN e.name AS name, e.type AS type, count(a) AS mentionCount
       ORDER BY mentionCount DESC LIMIT 20`,
    );
    const entityProminence = entitiesResult.records.map((r) => ({
      name: r.get("name"),
      type: r.get("type"),
      mentionCount: typeof r.get("mentionCount") === "object"
        ? r.get("mentionCount").toNumber()
        : r.get("mentionCount"),
    }));

    // Topic co-occurrence
    const coOccurrenceResult = await session.run(
      `MATCH (t1:Topic)-[r:RELATED_TO]-(t2:Topic)
       WHERE r.weight > 2
       RETURN t1.name AS topicA, t2.name AS topicB, r.weight AS count
       ORDER BY count DESC LIMIT 15`,
    );
    const topicCoOccurrence = coOccurrenceResult.records.map((r) => ({
      topicA: r.get("topicA"),
      topicB: r.get("topicB"),
      count: typeof r.get("count") === "object"
        ? r.get("count").toNumber()
        : r.get("count"),
    }));

    // Source distribution
    const sourceResult = await session.run(
      `MATCH (a:Article)-[:FROM_SOURCE]->(s:Source)
       WHERE a.publishedAt > datetime() - duration('P7D')
       RETURN s.name AS source, count(a) AS articleCount
       ORDER BY articleCount DESC`,
    );
    const sourceDistribution = sourceResult.records.map((r) => ({
      source: r.get("source"),
      articleCount: typeof r.get("articleCount") === "object"
        ? r.get("articleCount").toNumber()
        : r.get("articleCount"),
    }));

    // Get keyword frequency from PostgreSQL
    const keywordResult = await query<{ keyword: string; count: string }>(
      `SELECT unnest(topic_tags) AS keyword, count(*) AS count
       FROM articles
       WHERE published_at > now() - interval '7 days'
       GROUP BY keyword ORDER BY count DESC LIMIT 20`,
    );
    const trendingKeywords = keywordResult.rows.map((r) => ({
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

    const trendingKeywordsWithDelta = trendingKeywords.map((k) => ({
      ...k,
      count30d: keyword30dMap.get(k.keyword) || k.count7d,
      delta:
        k.count7d /
          Math.max(1, ((keyword30dMap.get(k.keyword) || k.count7d) - k.count7d) / 3 || 1) -
        1,
    }));

    // Article count
    const countResult = await query<{ count: string }>(
      "SELECT count(*) AS count FROM articles WHERE published_at > now() - interval '7 days'",
    );
    const articleCount = parseInt(countResult.rows[0].count);

    await logRun(runId, "info", "trend-report", `Trend data gathered: ${articleCount} articles, ${trendingTopics.length} topics, ${entityProminence.length} entities`);

    trendData = {
      articleCount,
      trendingKeywords: trendingKeywordsWithDelta,
      trendingTopics,
      entityProminence,
      topicCoOccurrence,
      sourceDistribution,
    };
  } finally {
    await session.close();
  }

  // Send to RocketRide for narrative analysis
  checkCancelled(runId);
  await logRun(runId, "info", "trend-report", "Sending data to AI for narrative analysis...");

  const result = await client.use({
    filepath: path.join(PIPELINES_DIR, "trend-report.pipe"),
  });
  const token = result.token;
  setActiveToken(runId, client, token);

  const response = await client.send(
    token,
    JSON.stringify(trendData),
    {},
    "application/json",
  );

  await client.terminate(token);

  let aiAnalysis: {
    executiveSummary?: string;
    narrativeAnalysis?: ReportData["narrativeAnalysis"];
    contentOpportunities?: ReportData["contentOpportunities"];
    emergingTopics?: string[];
  } = {};

  if (response?.answers && response.answers.length > 0) {
    const answer = response.answers[0];
    const raw = typeof answer === "string" ? answer : JSON.stringify(answer);
    aiAnalysis = await postProcessToJson(client, raw,
      '{"executiveSummary": "string", "narrativeAnalysis": {"keywords": "string", "topics": "string", "technologies": "string", "opportunities": "string"}, "contentOpportunities": [{"signal": "string", "source": "string", "url": "string"}], "emergingTopics": ["string"]}',
    );
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Build velocity outliers from keyword delta
  const velocityOutliers = (trendData.trendingKeywords as Array<{ keyword: string; count7d: number; count30d: number; delta: number }>)
    .filter((k) => k.delta > 0.5)
    .slice(0, 10)
    .map((k) => ({
      topic: k.keyword,
      spike: k.count7d,
      baseline: k.count30d / 4,
    }));

  // Technologies from entities
  const trendingTechnologies = (trendData.entityProminence as Array<{ name: string; type: string; mentionCount: number }>)
    .filter((e) => ["tool", "model", "language"].includes(e.type))
    .slice(0, 10)
    .map((e) => ({ name: e.name, type: e.type, mentionCount: e.mentionCount }));

  const reportData: ReportData = {
    executiveSummary: aiAnalysis.executiveSummary || "Report generated successfully.",
    period: { start: weekAgo.toISOString(), end: now.toISOString() },
    articleCount: trendData.articleCount as number,
    trendingKeywords: trendData.trendingKeywords as ReportData["trendingKeywords"],
    trendingTopics: (trendData.trendingTopics as Array<{ topic: string; trendScore: number; category: string }>).map((t) => ({
      topic: t.topic,
      trendScore: t.trendScore,
      sentiment: "neutral",
      articleCount: 0,
      sparkline: [],
    })),
    trendingTechnologies,
    emergingTopics: aiAnalysis.emergingTopics || [],
    entityProminence: trendData.entityProminence as ReportData["entityProminence"],
    topicCoOccurrence: trendData.topicCoOccurrence as ReportData["topicCoOccurrence"],
    velocityOutliers,
    contentOpportunities: aiAnalysis.contentOpportunities || [],
    sourceDistribution: (trendData.sourceDistribution as Array<{ source: string; articleCount: number }>).map((s) => ({
      ...s,
      topTopics: [],
    })),
    narrativeAnalysis: aiAnalysis.narrativeAnalysis || {
      keywords: "",
      topics: "",
      technologies: "",
      opportunities: "",
    },
  };

  // Save report
  const reportResult = await query<{ id: string }>(
    `INSERT INTO reports (run_id, period_start, period_end, report_data, article_count)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [runId, weekAgo, now, JSON.stringify(reportData), reportData.articleCount],
  );

  const reportId = reportResult.rows[0].id;
  await logRun(runId, "success", "trend-report", `Trend report saved: ${reportId}`);

  await query(
    `INSERT INTO notifications (type, title, message, link, reference_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      "report",
      "New Trend Report",
      `Report generated with ${reportData.articleCount} articles analyzed. ${reportData.emergingTopics.length} emerging topics identified.`,
      `/reports/${reportId}`,
      reportId,
    ],
  );

  return reportId;
}

async function runContentDrafts(
  client: Awaited<ReturnType<typeof getClient>>,
  runId: string,
  reportId: string,
) {
  await logRun(runId, "info", "content-drafts", "Starting content drafts pipeline...");

  // Get latest report
  const reportResult = await query<{ report_data: ReportData }>(
    "SELECT report_data FROM reports WHERE id = $1",
    [reportId],
  );
  const reportData = reportResult.rows[0].report_data;

  // Get top 10 articles from last 24h
  const articlesResult = await query<{ title: string; url: string; summary: string; source_name: string }>(
    `SELECT title, url, summary, source_name FROM articles
     WHERE published_at > now() - interval '24 hours' AND enriched_at IS NOT NULL
     ORDER BY score DESC NULLS LAST LIMIT 10`,
  );

  await logRun(runId, "info", "content-drafts", `Using ${articlesResult.rows.length} top articles for draft generation`);

  const payload = {
    report: {
      executiveSummary: reportData.executiveSummary,
      trendingTopics: reportData.trendingTopics.slice(0, 5),
      contentOpportunities: reportData.contentOpportunities.slice(0, 3),
      emergingTopics: reportData.emergingTopics,
    },
    topArticles: articlesResult.rows,
  };

  // Send to RocketRide
  checkCancelled(runId);
  await logRun(runId, "info", "content-drafts", "Sending data to AI for draft generation...");

  const result = await client.use({
    filepath: path.join(PIPELINES_DIR, "content-drafts.pipe"),
  });
  const token = result.token;
  setActiveToken(runId, client, token);

  const response = await client.send(
    token,
    JSON.stringify(payload),
    {},
    "application/json",
  );

  await client.terminate(token);

  let drafts: Record<string, string> = {};
  if (response?.answers && response.answers.length > 0) {
    const answer = response.answers[0];
    const raw = typeof answer === "string" ? answer : JSON.stringify(answer);
    drafts = await postProcessToJson(client, raw,
      '{"hashnode": "string", "medium": "string", "devto": "string", "hackernews": "string", "linkedin": "string", "twitter": "string", "discord": "string"}',
    );
  }

  // Save each draft
  const platformMapping: Record<string, { contentType: string }> = {
    hashnode: { contentType: "article" },
    medium: { contentType: "article" },
    devto: { contentType: "article" },
    hackernews: { contentType: "article" },
    linkedin: { contentType: "social" },
    twitter: { contentType: "social" },
    discord: { contentType: "social" },
  };

  let savedCount = 0;
  for (const [platform, body] of Object.entries(drafts)) {
    if (!platformMapping[platform]) continue;
    const content = typeof body === "string" ? body : JSON.stringify(body);
    if (!content || content.length < 10) {
      await logRun(runId, "warn", "content-drafts", `Skipped ${platform}: empty or too short`);
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
      await logRun(runId, "error", "content-drafts", `Failed to save ${platform} draft: ${err}`);
    }
  }

  await logRun(runId, "success", "content-drafts", `Content drafts saved: ${savedCount} of ${Object.keys(drafts).length} platforms`);

  await query(
    `INSERT INTO notifications (type, title, message, link, reference_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      "drafts",
      "Content Drafts Ready",
      `${savedCount} platform drafts generated and ready for review.`,
      "/drafts",
      reportId,
    ],
  );

  return savedCount;
}

export async function runAllPipelines(trigger: "scheduled" | "manual" = "scheduled") {
  // Create pipeline run
  const runResult = await query<{ id: string }>(
    "INSERT INTO runs (trigger, run_type) VALUES ($1, 'pipeline') RETURNING id",
    [trigger],
  );
  const runId = runResult.rows[0].id;

  let client: Awaited<ReturnType<typeof getClient>> | null = null;
  try {
    await logRun(runId, "info", "init", `Pipeline run started (trigger: ${trigger})`);
    client = await getClient();
    await logRun(runId, "info", "init", "Connected to RocketRide");

    // Sequential pipeline execution — trend report + content drafts only
    // (articles are enriched programmatically at scrape time)
    const reportId = await runTrendReport(client, runId);
    let draftCount = 0;

    if (reportId) {
      draftCount = await runContentDrafts(client, runId, reportId);
    }

    await query(
      "UPDATE runs SET completed_at = now(), status = 'complete' WHERE id = $1",
      [runId],
    );

    await cleanupJsonConverter(client);
    await logRun(runId, "success", "complete", "All pipelines complete");

    // Send email notification
    if (reportId) {
      try {
        await sendReportEmail(reportId);
        await logRun(runId, "info", "email", "Report email sent");
      } catch (emailErr) {
        await logRun(runId, "warn", "email", `Failed to send email: ${emailErr}`);
      }
    }

    activeRuns.delete(runId);
    return { runId, reportId };
  } catch (err) {
    if (client) await cleanupJsonConverter(client).catch(() => {});
    const cancelled = activeRuns.get(runId)?.aborted;
    activeRuns.delete(runId);
    const status = cancelled ? "cancelled" : "failed";
    const message = cancelled ? "Run was cancelled by user" : String(err);
    await logRun(runId, "error", "fatal", message);
    await query(
      "UPDATE runs SET completed_at = now(), status = $1, error_log = $2 WHERE id = $3",
      [status, message, runId],
    );
    if (!cancelled) throw err;
    return { runId, reportId: null };
  }
}
