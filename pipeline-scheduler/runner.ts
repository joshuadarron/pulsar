import { getClient, disconnectClient } from "@/lib/rocketride";
import { query } from "@/lib/db/postgres";
import { getSession } from "@/lib/db/neo4j";
import type { ReportData } from "@/types";
import path from "path";

const PIPELINES_DIR = path.join(process.cwd(), "pipelines");

async function runSummarization(client: Awaited<ReturnType<typeof getClient>>) {
  console.log("[Pipeline] Running summarization...");

  // Get unenriched articles from last 24h
  const articles = await query<{
    id: string;
    title: string;
    url: string;
    raw_id: string;
  }>(
    `SELECT a.id, a.title, a.url, a.raw_id
     FROM articles a
     WHERE a.enriched_at IS NULL
       AND a.published_at > now() - interval '24 hours'
     ORDER BY a.published_at DESC`,
  );

  if (articles.rows.length === 0) {
    console.log("[Pipeline] No unenriched articles found.");
    return;
  }

  console.log(`[Pipeline] Enriching ${articles.rows.length} articles...`);

  // Start the summarization pipeline
  const result = await client.use({
    filepath: path.join(PIPELINES_DIR, "summarization.pipe"),
  });
  const token = result.token;

  for (const article of articles.rows) {
    // Get raw content
    const raw = await query<{ raw_payload: Record<string, unknown> }>(
      "SELECT raw_payload FROM articles_raw WHERE id = $1",
      [article.raw_id],
    );

    const payload = raw.rows[0]?.raw_payload;
    const text = `Title: ${article.title}\n\nContent: ${(payload as { rawContent?: string })?.rawContent || article.title}`;

    try {
      const response = await client.send(token, text);

      // Parse the answer
      let enrichment: {
        summary?: string;
        contentType?: string;
        sentiment?: string;
        topicTags?: string[];
        entityMentions?: { name: string; type: string }[];
      } = {};

      if (response?.answers && response.answers.length > 0) {
        const answer = response.answers[0];
        enrichment = typeof answer === "string" ? JSON.parse(answer) : answer;
      }

      // Update article with enriched data
      await query(
        `UPDATE articles SET
           summary = $1,
           content_type = $2,
           sentiment = $3,
           topic_tags = $4,
           entity_mentions = $5,
           enriched_at = now()
         WHERE id = $6`,
        [
          enrichment.summary || null,
          enrichment.contentType || null,
          enrichment.sentiment || null,
          enrichment.topicTags || [],
          JSON.stringify(enrichment.entityMentions || []),
          article.id,
        ],
      );
    } catch (err) {
      console.error(`[Pipeline] Failed to enrich article ${article.id}:`, err);
    }
  }

  await client.terminate(token);
  console.log("[Pipeline] Summarization complete.");
}

async function runTrendReport(
  client: Awaited<ReturnType<typeof getClient>>,
  runId: string,
): Promise<string | null> {
  console.log("[Pipeline] Running trend report...");

  // Gather trend data from Neo4j
  const session = getSession();
  let trendData: Record<string, unknown>;

  try {
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
  const result = await client.use({
    filepath: path.join(PIPELINES_DIR, "trend-report.pipe"),
  });
  const token = result.token;

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
    aiAnalysis = typeof answer === "string" ? JSON.parse(answer) : answer;
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
  console.log(`[Pipeline] Trend report saved: ${reportId}`);
  return reportId;
}

async function runContentDrafts(
  client: Awaited<ReturnType<typeof getClient>>,
  runId: string,
  reportId: string,
) {
  console.log("[Pipeline] Running content drafts...");

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
  const result = await client.use({
    filepath: path.join(PIPELINES_DIR, "content-drafts.pipe"),
  });
  const token = result.token;

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
    drafts = typeof answer === "string" ? JSON.parse(answer) : answer;
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

  for (const [platform, body] of Object.entries(drafts)) {
    if (!platformMapping[platform] || !body) continue;

    await query(
      `INSERT INTO content_drafts (run_id, report_id, platform, content_type, body)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, reportId, platform, platformMapping[platform].contentType, body],
    );
  }

  console.log(`[Pipeline] Content drafts saved for ${Object.keys(drafts).length} platforms.`);
}

export async function runAllPipelines(trigger: "scheduled" | "manual" = "scheduled") {
  // Create pipeline run
  const runResult = await query<{ id: string }>(
    "INSERT INTO runs (trigger, run_type) VALUES ($1, 'pipeline') RETURNING id",
    [trigger],
  );
  const runId = runResult.rows[0].id;

  try {
    const client = await getClient();

    // Sequential pipeline execution
    await runSummarization(client);
    const reportId = await runTrendReport(client, runId);

    if (reportId) {
      await runContentDrafts(client, runId, reportId);
    }

    await query(
      "UPDATE runs SET completed_at = now(), status = 'complete' WHERE id = $1",
      [runId],
    );

    console.log(`[Pipeline] All pipelines complete. Run: ${runId}`);
    return { runId, reportId };
  } catch (err) {
    await query(
      "UPDATE runs SET completed_at = now(), status = 'failed', error_log = $1 WHERE id = $2",
      [String(err), runId],
    );
    throw err;
  }
}
