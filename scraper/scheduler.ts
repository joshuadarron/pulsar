import "dotenv/config";
import cron from "node-cron";
import { sources } from "./sources/index.js";
import { hashUrl, exists } from "./dedup.js";
import { extractKeywords, extractEntities, categorizeSource } from "./extract.js";
import { writeArticleToGraph } from "./graph-writer.js";
import { updateTrendScores } from "./trend-scorer.js";
import { query } from "@/lib/db/postgres";
import { env } from "@/config/env";

async function runScrape() {
  const runResult = await query<{ id: string }>(
    "INSERT INTO runs (trigger, run_type) VALUES ('scheduled', 'scrape') RETURNING id",
  );
  const runId = runResult.rows[0].id;
  console.log(`[${new Date().toISOString()}] Scheduled scrape ${runId} started`);

  let totalScraped = 0;
  let totalNew = 0;

  for (const [name, adapter] of Object.entries(sources)) {
    try {
      const items = await adapter();
      totalScraped += items.length;

      for (const item of items) {
        const urlHash = hashUrl(item.url);
        if (await exists(urlHash)) continue;

        const rawResult = await query<{ id: string }>(
          `INSERT INTO articles_raw (url_hash, url, raw_payload, source_name, run_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [urlHash, item.url, JSON.stringify(item), item.sourceName, runId],
        );
        const rawId = rawResult.rows[0].id;

        const text = `${item.title} ${item.rawContent}`;
        const keywords = extractKeywords(text, 10);
        const entities = extractEntities(text);
        const category = categorizeSource(item.sourcePlatform);

        const articleResult = await query<{ id: string }>(
          `INSERT INTO articles (raw_id, url, title, topic_tags, entity_mentions, published_at, source_name, source_platform, score, comment_count, run_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [rawId, item.url, item.title, keywords, JSON.stringify(entities), item.publishedAt, item.sourceName, item.sourcePlatform, item.score ?? null, item.commentCount ?? null, runId],
        );

        await writeArticleToGraph(item, articleResult.rows[0].id, keywords, entities, category);
        totalNew++;
      }
    } catch (err) {
      console.error(`Error scraping ${name}:`, err);
      await query(
        "UPDATE runs SET error_log = COALESCE(error_log, '') || $1 WHERE id = $2",
        [`\n[${name}] ${err}`, runId],
      );
    }
  }

  await updateTrendScores();

  await query(
    "UPDATE runs SET completed_at = now(), status = 'complete', articles_scraped = $1, articles_new = $2 WHERE id = $3",
    [totalScraped, totalNew, runId],
  );

  console.log(`[${new Date().toISOString()}] Scrape ${runId} complete. Scraped: ${totalScraped}, New: ${totalNew}`);
}

console.log(`Scraper scheduler started. Crons: ${env.scraper.cron1}, ${env.scraper.cron2}`);

cron.schedule(env.scraper.cron1, () => {
  runScrape().catch((err) => console.error("Scheduled scrape failed:", err));
});

cron.schedule(env.scraper.cron2, () => {
  runScrape().catch((err) => console.error("Scheduled scrape failed:", err));
});
