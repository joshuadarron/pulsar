import { sources } from "./sources/index.js";
import { hashUrl, exists } from "./dedup.js";
import { extractKeywords, extractEntities, categorizeSource, analyzeSentiment, classifyContentType, extractSummary } from "./extract.js";
import { writeArticleToGraph } from "./graph-writer.js";
import { updateTrendScores } from "./trend-scorer.js";
import { query } from "@pulsar/shared/db/postgres";
import { withRetry } from "./lib/retry.js";
import { logRun } from "@pulsar/shared/run-logger";

export async function scrape(sourceFilter?: string, trigger: "scheduled" | "manual" = "manual") {
  // Create run record
  const runResult = await query<{ id: string }>(
    "INSERT INTO runs (trigger, run_type) VALUES ($1, 'scrape') RETURNING id",
    [trigger],
  );
  const runId = runResult.rows[0].id;
  await logRun(runId, "info", "init", `Scrape run started (trigger: ${trigger})`);

  let totalScraped = 0;
  let totalNew = 0;

  const adapters = sourceFilter
    ? { [sourceFilter]: sources[sourceFilter] }
    : sources;

  if (sourceFilter && !sources[sourceFilter]) {
    await logRun(runId, "error", "init", `Unknown source: ${sourceFilter}. Available: ${Object.keys(sources).join(", ")}`);
    return;
  }

  const sourceNames = Object.keys(adapters);
  await logRun(runId, "info", "init", `Scraping ${sourceNames.length} sources: ${sourceNames.join(", ")}`);

  for (const [name, adapter] of Object.entries(adapters)) {
    await logRun(runId, "info", name, `Scraping ${name}...`);
    try {
      const items = await withRetry(() => adapter(), 3, 2000);
      totalScraped += items.length;
      await logRun(runId, "info", name, `Fetched ${items.length} items from ${name}`);

      let sourceNew = 0;
      for (const item of items) {
        const urlHash = hashUrl(item.url);

        if (await exists(urlHash)) continue;

        // Insert into articles_raw
        const rawResult = await query<{ id: string }>(
          `INSERT INTO articles_raw (url_hash, url, raw_payload, source_name, run_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [urlHash, item.url, JSON.stringify(item), item.sourceName, runId],
        );
        const rawId = rawResult.rows[0].id;

        // Extract keywords, entities, and enrich programmatically
        const text = `${item.title} ${item.rawContent}`;
        const keywords = extractKeywords(text, 10);
        const entities = extractEntities(text);
        const category = categorizeSource(item.sourcePlatform);
        const sentiment = analyzeSentiment(text);
        const contentType = classifyContentType(item.title, item.sourcePlatform);
        const summary = extractSummary(item.title, item.rawContent);

        // Insert into articles — fully enriched at scrape time
        const articleResult = await query<{ id: string }>(
          `INSERT INTO articles (raw_id, url, title, summary, content_type, sentiment, topic_tags, entity_mentions, published_at, source_name, source_platform, score, comment_count, enriched_at, run_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14) RETURNING id`,
          [
            rawId,
            item.url,
            item.title,
            summary,
            contentType,
            sentiment,
            keywords,
            JSON.stringify(entities),
            item.publishedAt,
            item.sourceName,
            item.sourcePlatform,
            item.score ?? null,
            item.commentCount ?? null,
            runId,
          ],
        );

        // Write to Neo4j
        await writeArticleToGraph(item, articleResult.rows[0].id, keywords, entities, category);

        sourceNew++;
        totalNew++;
      }

      await logRun(runId, "success", name, `${name} complete: ${items.length} scraped, ${sourceNew} new`);

      // Update running counts
      await query(
        "UPDATE runs SET articles_scraped = $1, articles_new = $2 WHERE id = $3",
        [totalScraped, totalNew, runId],
      );
    } catch (err) {
      await logRun(runId, "error", name, `Error scraping ${name}: ${err}`);
      await query(
        "UPDATE runs SET error_log = COALESCE(error_log, '') || $1 WHERE id = $2",
        [`\n[${name}] ${err}`, runId],
      );
    }
  }

  // Update trend scores
  await logRun(runId, "info", "trend-scores", "Updating trend scores...");
  await updateTrendScores();
  await logRun(runId, "success", "trend-scores", "Trend scores updated");

  // Complete run
  await query(
    "UPDATE runs SET completed_at = now(), status = 'complete', articles_scraped = $1, articles_new = $2 WHERE id = $3",
    [totalScraped, totalNew, runId],
  );

  await logRun(runId, "success", "complete", `Scrape complete. Scraped: ${totalScraped}, New: ${totalNew}`);
}
