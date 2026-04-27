import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), "../../../.env") });

import { query } from "./postgres";
import { getSession, closeDriver } from "./neo4j";
import pool from "./postgres";

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
    CREATE UNIQUE INDEX IF NOT EXISTS runs_one_active_per_type
    ON runs (run_type) WHERE status = 'running'
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS run_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID REFERENCES runs(id) ON DELETE CASCADE,
      logged_at TIMESTAMPTZ DEFAULT now(),
      level TEXT DEFAULT 'info',
      stage TEXT,
      message TEXT NOT NULL
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON run_logs (run_id, logged_at)
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

  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      reference_id TEXT,
      read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await query(`
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id TEXT
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (read, created_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS schedules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL,
      hour INT NOT NULL,
      minute INT NOT NULL,
      days INT[] NOT NULL DEFAULT '{1,2,3,4,5}',
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS schedules_unique_time
    ON schedules (type, hour, minute, days)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS graph_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      topic_clusters JSONB NOT NULL,
      entity_importance JSONB NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_graph_snapshots_computed_at
    ON graph_snapshots (computed_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS pipeline_validations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL,
      pipeline_name TEXT NOT NULL,
      validated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      passed BOOLEAN NOT NULL,
      checks JSONB NOT NULL,
      error_summary TEXT
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_pipeline_validations_run_id
    ON pipeline_validations (run_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_pipeline_validations_validated_at
    ON pipeline_validations (validated_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS evaluations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      dimension TEXT NOT NULL,
      score INTEGER,
      passed BOOLEAN,
      rationale TEXT,
      judge_model TEXT NOT NULL,
      judged_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_evaluations_run_id ON evaluations (run_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_evaluations_target_type_judged_at
    ON evaluations (target_type, judged_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_evaluations_dimension ON evaluations (dimension)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS report_predictions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      prediction_text TEXT NOT NULL,
      predicted_entities TEXT[],
      predicted_topics TEXT[],
      prediction_type TEXT NOT NULL,
      extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_report_predictions_report_id
    ON report_predictions (report_id)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS retrospective_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      prediction_id UUID NOT NULL REFERENCES report_predictions(id) ON DELETE CASCADE,
      graded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      outcome TEXT NOT NULL,
      evidence_summary TEXT NOT NULL,
      judge_model TEXT NOT NULL,
      evidence_data JSONB
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_retrospective_grades_prediction_id
    ON retrospective_grades (prediction_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_retrospective_grades_graded_at
    ON retrospective_grades (graded_at DESC)
  `);

  // Seed defaults if table is empty
  await query(`
    INSERT INTO schedules (type, hour, minute, days)
    SELECT 'scrape', 5, 30, '{1,2,3,4,5}'
    WHERE NOT EXISTS (SELECT 1 FROM schedules WHERE type = 'scrape')
  `);

  await query(`
    INSERT INTO schedules (type, hour, minute, days)
    SELECT 'pipeline', 6, 0, '{1,2,3,4,5}'
    WHERE NOT EXISTS (SELECT 1 FROM schedules WHERE type = 'pipeline')
  `);

  await query(`
    INSERT INTO schedules (type, hour, minute, days)
    SELECT 'retrospective', 7, 0, '{1,2,3,4,5}'
    WHERE NOT EXISTS (SELECT 1 FROM schedules WHERE type = 'retrospective')
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
