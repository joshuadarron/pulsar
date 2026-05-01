# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### [2026-05-01] Phase 2: Scraper backfill infrastructure

#### Added

- Historical backfill subsystem under `packages/scraper/backfill/` covering Wayback CDX (with rate limiting and disk cache under `.cache/wayback/`), per-source strategies (arxiv and hackernews via direct archive APIs, github via Search API, reddit/hashnode/medium/devto/rss via Wayback CDX), a Postgres-backed job queue, and a long-running worker process.
- `pnpm run backfill --source=<name> --from=YYYY-MM-DD --to=YYYY-MM-DD` CLI for manual operator triggering.
- `pnpm run backfill-worker` long-running process. Acquires advisory lock 73953 (separate from the scrape scheduler at 73952) so backfill never blocks live scrapes.
- Auto-enqueue on first deploy: when `ENABLE_BACKFILL=true` and a source has fewer than 30 articles, the scheduler enqueues a full backfill from 2022-12-01 (ChatGPT release).
- Gap detection on every scheduler tick: per-source thresholds (e.g., reddit 7 days, arxiv 2 days, rss 14 days) trigger gap-fill backfill jobs automatically.
- Schema additions: `articles_raw.source_origin` (live | wayback | common_crawl | direct_archive), `articles_raw.composite_hash` (partial unique index), `articles_raw.backfill_run_id`, `backfill_runs` and `backfill_jobs` tables.
- Composite dedup hash via `hashComposite(sourceName, publishedAt, normalizedUrl)` lets backfill and live ingestion coexist on recent dates without collision.
- New shared types: `SourceOrigin`, `BackfillRun`, `BackfillJob`, `BackfillStatus`, `BackfillJobStatus`. `ScrapedItem` now carries optional `sourceOrigin` and `backfillRunId`.
- `env.backfill = { enabled, enableCommonCrawl, workerConcurrency }` config block. Controlled by `ENABLE_BACKFILL`, `ENABLE_COMMON_CRAWL`, `BACKFILL_WORKER_CONCURRENCY`.

#### Changed

- `packages/scraper/scheduler.ts` runs gap detection and `maybeAutoEnqueue` after each scrape tick. Both are idempotent and short-circuit when the feature flag is off.
- Root `.gitignore` adds `.cache/` (Wayback cache directory).

### [2026-04-30] Phase 1: Apps framework

#### Added

- `packages/apps/` directory housing self-contained domain workflows
- `@pulsar/app-market-analysis` workspace package containing the existing market-analysis pipelines, prompts, and UI
- `app.config.ts` per-app configuration declaring schedule defaults, expected context fields, and render mode
- `packages/apps/README.md` documenting the app contract and future-app scaffolds (technical-roadmap, financial-analysis, onboarding)

#### Changed

- `.pipe` files now live under `packages/apps/market-analysis/pipelines/` and are tracked in git (Postgres password templated to `${POSTGRES_PASSWORD}`)
- `packages/pipeline/runner.ts` imports prompts and pipelines directory from `@pulsar/app-market-analysis`
- `packages/web/app/(dashboard)/drafts/page.tsx` is now a thin re-export shim; the implementation lives in `@pulsar/app-market-analysis/ui/drafts`
- `pnpm-workspace.yaml` includes `packages/apps/*`

### Phase 0 (2026-04-30)

#### Added

- Operator-agnostic configuration via `.voice/` and `.context/` directories. Both are gitignored, generated at setup, and read at runtime by future loaders.
- `@pulsar/cli` package with `pulsar init`, `pulsar init --from-config <path>`, and `pulsar setup` entry points. Interactive flow uses `@inquirer/prompts`; non-interactive flow reads YAML.
- Postinstall hook for interactive setup on fresh clone. Skips cleanly in non-TTY environments, when installed as a transitive dependency, and when configuration already exists.
- `packages/cli/sample-config.rocketride.yaml` reflecting the prior hardcoded RocketRide values from `packages/pipeline/trend-report-prompts.ts`. Operators can rebuild their original setup with `pulsar init --from-config packages/cli/sample-config.rocketride.yaml`.

#### Changed

- `packages/pipeline/trend-report-prompts.ts` now exports `buildSystemPrompt(ctx)` and `buildSectionPrompts(ctx)`. The previous hardcoded `SYSTEM_PROMPT` and `SECTION_PROMPTS` constants were removed; identity, positioning, audience, hard rules, and grounding URLs are interpolated from `@pulsar/context` at runtime.
- `packages/pipeline/runner.ts` loads `loadOperatorContext()` once per run and threads it through every pass. Pipelines refuse to start with a clear error message when `.context/` is not configured.
- `packages/web/lib/auth.ts` reads the GitHub allowlist from `loadOperatorContext().allowedGitHubLogins` instead of a hardcoded array. When operator context is missing, the allowlist falls back to empty (no logins permitted) and a warning is logged.
