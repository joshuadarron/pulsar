import "dotenv/config";
import { query } from "./postgres.js";
import { getSession, closeDriver } from "./neo4j.js";
import pool from "./postgres.js";

async function migratePostgres() {
  console.log("Running PostgreSQL migrations...");

  await query(`
    CREATE TABLE IF NOT EXISTS runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      started_at TIMESTAMPTZ DEFAULT now(),
      completed_at TIMESTAMPTZ,
      status TEXT DEFAULT 'running',
      trigger TEXT DEFAULT 'scheduled',
      run_type TEXT DEFAULT 'scrape',
      articles_scraped INT DEFAULT 0,
      articles_new INT DEFAULT 0,
      error_log TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS articles_raw (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      url_hash CHAR(64) UNIQUE NOT NULL,
      url TEXT NOT NULL,
      raw_payload JSONB NOT NULL,
      source_name TEXT NOT NULL,
      scraped_at TIMESTAMPTZ DEFAULT now(),
      run_id UUID REFERENCES runs(id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS articles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      raw_id UUID REFERENCES articles_raw(id),
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      content_type TEXT,
      sentiment TEXT,
      topic_tags TEXT[],
      entity_mentions JSONB,
      published_at TIMESTAMPTZ,
      source_name TEXT,
      source_platform TEXT,
      score INT,
      comment_count INT,
      enriched_at TIMESTAMPTZ,
      run_id UUID REFERENCES runs(id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID REFERENCES runs(id),
      generated_at TIMESTAMPTZ DEFAULT now(),
      period_start TIMESTAMPTZ,
      period_end TIMESTAMPTZ,
      report_data JSONB NOT NULL,
      article_count INT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS content_drafts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID REFERENCES runs(id),
      report_id UUID REFERENCES reports(id),
      platform TEXT NOT NULL,
      content_type TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  console.log("PostgreSQL migrations complete.");
}

async function migrateNeo4j() {
  console.log("Running Neo4j constraints...");
  const session = getSession();
  try {
    await session.run(
      "CREATE CONSTRAINT article_id IF NOT EXISTS FOR (a:Article) REQUIRE a.id IS UNIQUE",
    );
    await session.run(
      "CREATE CONSTRAINT topic_name IF NOT EXISTS FOR (t:Topic) REQUIRE t.name IS UNIQUE",
    );
    await session.run(
      "CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE",
    );
    await session.run(
      "CREATE CONSTRAINT author_handle IF NOT EXISTS FOR (a:Author) REQUIRE a.handle IS UNIQUE",
    );
    await session.run(
      "CREATE CONSTRAINT source_name IF NOT EXISTS FOR (s:Source) REQUIRE s.name IS UNIQUE",
    );
    console.log("Neo4j constraints created.");
  } finally {
    await session.close();
  }
}

async function main() {
  try {
    await migratePostgres();
    await migrateNeo4j();
    console.log("All migrations complete.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await closeDriver();
    await pool.end();
  }
}

main();
