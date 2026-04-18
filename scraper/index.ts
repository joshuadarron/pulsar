import "dotenv/config";
import { sources } from "./sources/index.js";
import { hashUrl, exists } from "./dedup.js";
import { extractKeywords, extractEntities, categorizeSource } from "./extract.js";
import { writeArticleToGraph } from "./graph-writer.js";
import { updateTrendScores } from "./trend-scorer.js";
import { query } from "@/lib/db/postgres";
import { closeDriver } from "@/lib/db/neo4j";
import pool from "@/lib/db/postgres";
import { withRetry } from "@/lib/retry";

async function scrape(sourceFilter?: string, trigger: "scheduled" | "manual" = "manual") {
  // Create run record
  const runResult = await query<{ id: string }>(
    "INSERT INTO runs (trigger, run_type) VALUES ($1, 'scrape') RETURNING id",
    [trigger],
  );
  const runId = runResult.rows[0].id;
  console.log(`Run ${runId} started (trigger: ${trigger})`);

  let totalScraped = 0;
  let totalNew = 0;

  const adapters = sourceFilter
    ? { [sourceFilter]: sources[sourceFilter] }
    : sources;

  if (sourceFilter && !sources[sourceFilter]) {
    console.error(`Unknown source: ${sourceFilter}. Available: ${Object.keys(sources).join(", ")}`);
    process.exit(1);
  }

  for (const [name, adapter] of Object.entries(adapters)) {
    console.log(`Scraping ${name}...`);
    try {
      const items = await withRetry(() => adapter(), 3, 2000);
      totalScraped += items.length;
      console.log(`  Fetched ${items.length} items from ${name}`);

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

        // Extract keywords and entities
        const text = `${item.title} ${item.rawContent}`;
        const keywords = extractKeywords(text, 10);
        const entities = extractEntities(text);
        const category = categorizeSource(item.sourcePlatform);

        // Insert into articles
        const articleResult = await query<{ id: string }>(
          `INSERT INTO articles (raw_id, url, title, topic_tags, entity_mentions, published_at, source_name, source_platform, score, comment_count, run_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [
            rawId,
            item.url,
            item.title,
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

        totalNew++;
      }

      console.log(`  ${name}: ${totalNew} new articles inserted`);
    } catch (err) {
      console.error(`  Error scraping ${name}:`, err);
      await query(
        "UPDATE runs SET error_log = COALESCE(error_log, '') || $1 WHERE id = $2",
        [`\n[${name}] ${err}`, runId],
      );
    }
  }

  // Update trend scores
  await updateTrendScores();

  // Complete run
  await query(
    "UPDATE runs SET completed_at = now(), status = 'complete', articles_scraped = $1, articles_new = $2 WHERE id = $3",
    [totalScraped, totalNew, runId],
  );

  console.log(`Run ${runId} complete. Scraped: ${totalScraped}, New: ${totalNew}`);
}

// CLI entry point
const args = process.argv.slice(2);
let sourceFilter: string | undefined;
for (const arg of args) {
  if (arg.startsWith("--source=")) {
    sourceFilter = arg.split("=")[1];
  }
}

scrape(sourceFilter)
  .catch((err) => {
    console.error("Fatal scrape error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDriver();
    await pool.end();
  });
