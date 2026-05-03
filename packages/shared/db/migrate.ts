import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), '../../../.env') });

import { closeDriver, getSession } from './neo4j';
import { query } from './postgres';
import pool from './postgres';

async function migratePostgres() {
	console.log('Running PostgreSQL migrations...');

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

	// ---------------------------------------------------------------------------
	// Observability (RocketRide runtime event ingestion)
	// ---------------------------------------------------------------------------

	await query(`
    CREATE TABLE IF NOT EXISTS pipeline_run_traces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      rr_token TEXT,
      pipeline TEXT NOT NULL,
      pipe_id INT NOT NULL,
      op TEXT NOT NULL,
      component TEXT,
      trace JSONB NOT NULL,
      result JSONB,
      rr_seq BIGINT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

	await query(`
    CREATE INDEX IF NOT EXISTS idx_pipeline_run_traces_run_id
    ON pipeline_run_traces (run_id, occurred_at)
  `);

	await query(`
    CREATE INDEX IF NOT EXISTS idx_pipeline_run_traces_pipe
    ON pipeline_run_traces (run_id, pipeline, pipe_id, occurred_at)
  `);

	await query(`
    CREATE TABLE IF NOT EXISTS orphan_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type TEXT NOT NULL,
      rr_token TEXT,
      project_id TEXT,
      source TEXT,
      body JSONB NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

	await query(`
    CREATE INDEX IF NOT EXISTS idx_orphan_events_received_at
    ON orphan_events (received_at DESC)
  `);

	await query(`
    ALTER TABLE run_logs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'pulsar'
  `);

	await query(`
    ALTER TABLE run_logs ADD COLUMN IF NOT EXISTS trace_id UUID
  `);

	await query(`
    CREATE INDEX IF NOT EXISTS idx_run_logs_run_source
    ON run_logs (run_id, source, logged_at)
  `);

	// ---------------------------------------------------------------------------
	// Phase 2: Backfill infrastructure (source_origin, composite_hash, queues)
	// ---------------------------------------------------------------------------

	await query(`
    ALTER TABLE articles_raw ADD COLUMN IF NOT EXISTS source_origin TEXT NOT NULL DEFAULT 'live'
      CHECK (source_origin IN ('live', 'wayback', 'common_crawl', 'direct_archive'))
  `);

	await query(`
    ALTER TABLE articles_raw ADD COLUMN IF NOT EXISTS composite_hash CHAR(64)
  `);

	await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS articles_raw_composite_hash_idx
    ON articles_raw (composite_hash) WHERE composite_hash IS NOT NULL
  `);

	await query(`
    CREATE TABLE IF NOT EXISTS backfill_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_name TEXT NOT NULL,
      window_start TIMESTAMPTZ NOT NULL,
      window_end TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'complete', 'failed')),
      articles_ingested INTEGER NOT NULL DEFAULT 0,
      errors JSONB,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

	await query(`
    CREATE INDEX IF NOT EXISTS backfill_runs_status_idx ON backfill_runs (status)
  `);

	await query(`
    CREATE INDEX IF NOT EXISTS backfill_runs_source_window_idx
    ON backfill_runs (source_name, window_start, window_end)
  `);

	await query(`
    CREATE TABLE IF NOT EXISTS backfill_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      backfill_run_id UUID REFERENCES backfill_runs(id) ON DELETE CASCADE,
      source_name TEXT NOT NULL,
      window_start TIMESTAMPTZ NOT NULL,
      window_end TIMESTAMPTZ NOT NULL,
      strategy TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'claimed', 'running', 'complete', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      claimed_by TEXT,
      claimed_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

	await query(`
    CREATE INDEX IF NOT EXISTS backfill_jobs_status_created_idx
    ON backfill_jobs (status, created_at)
  `);

	await query(`
    ALTER TABLE articles_raw ADD COLUMN IF NOT EXISTS backfill_run_id UUID
      REFERENCES backfill_runs(id) ON DELETE SET NULL
  `);

	await query(`
    CREATE INDEX IF NOT EXISTS articles_raw_backfill_run_id_idx
    ON articles_raw (backfill_run_id) WHERE backfill_run_id IS NOT NULL
  `);

	// ---------------------------------------------------------------------------
	// Phase 5: Content drafts split (angle, opportunity_signal, metadata)
	// New columns are nullable so legacy single-pass rows remain queryable.
	// Phase 6 UI groups drafts by (report_id, angle).
	// ---------------------------------------------------------------------------

	await query(`
    ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS angle TEXT
  `);

	await query(`
    ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS opportunity_signal TEXT
  `);

	await query(`
    ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS metadata JSONB
  `);

	await query(`
    CREATE INDEX IF NOT EXISTS content_drafts_report_angle_idx
    ON content_drafts (report_id, angle)
  `);

	// Phase: context-builder. Track which graph snapshot a report saw so reconstruction
	// (e.g., --content-only --report-id=<old>) reproduces the same intelligence view.
	// Nullable for legacy rows generated before this column existed; the context
	// builder will compute a fresh snapshot for those windows on demand.
	await query(`
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS graph_snapshot_id UUID
      REFERENCES graph_snapshots(id) ON DELETE SET NULL
  `);
	await query(`
    CREATE INDEX IF NOT EXISTS reports_graph_snapshot_id_idx
    ON reports (graph_snapshot_id) WHERE graph_snapshot_id IS NOT NULL
  `);

	// Phase: content recommendations V2. Each draft row carries the full
	// recommendation header it came from (title/format/target/why_now) so the
	// drafts UI can render the legacy report's Content Recommendations layout.
	// All nullable; existing rows pre-V2 stay valid.
	await query(`
    ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS title TEXT
  `);
	await query(`
    ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS format TEXT
  `);
	await query(`
    ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS target TEXT
  `);
	await query(`
    ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS why_now TEXT
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

	console.log('PostgreSQL migrations complete.');
}

async function migrateNeo4j() {
	console.log('Running Neo4j constraints...');
	const session = getSession();
	try {
		await session.run(
			'CREATE CONSTRAINT article_id IF NOT EXISTS FOR (a:Article) REQUIRE a.id IS UNIQUE'
		);
		await session.run(
			'CREATE CONSTRAINT topic_name IF NOT EXISTS FOR (t:Topic) REQUIRE t.name IS UNIQUE'
		);
		await session.run(
			'CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE'
		);
		await session.run(
			'CREATE CONSTRAINT author_handle IF NOT EXISTS FOR (a:Author) REQUIRE a.handle IS UNIQUE'
		);
		await session.run(
			'CREATE CONSTRAINT source_name IF NOT EXISTS FOR (s:Source) REQUIRE s.name IS UNIQUE'
		);
		console.log('Neo4j constraints created.');
	} finally {
		await session.close();
	}
}

async function main() {
	try {
		await migratePostgres();
		await migrateNeo4j();
		console.log('All migrations complete.');
	} catch (err) {
		console.error('Migration failed:', err);
		process.exit(1);
	} finally {
		await closeDriver();
		await pool.end();
	}
}

main();
