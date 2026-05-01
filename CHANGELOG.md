# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

This release reshapes Pulsar from a single-operator market-intelligence tool into a configurable agent framework. Operators bring their own voice and context at install time, the trend report runs as a four-pass pipeline with a new section structure, content drafts run as a two-pass angle-picker plus drafter, and the dashboard groups drafts per report. Each phase below lists the user-facing changes that landed in that PR.

### [2026-05-01] Phase 6: Drafts UI

#### Added

- Report-grouped drafts list at `/drafts`. Each card shows the report date, the top opportunity (derived from the first interpretation's `meaning`), and the count of drafts and platforms.
- Per-report viewer at `/drafts/<reportId>`. Drafts grouped by `angle`, with platform tabs and four content tabs per platform: generated content, steps to post, voice transfer prompt, topic refinement prompt. Server-rendered, with only the tab switcher and copy-to-clipboard buttons client-side.
- Seven post-step templates (one per platform) and two scoping prompt templates (voice transfer, topic refinement) under `packages/apps/market-analysis/templates/`. Pure fill helpers exported as `@pulsar/app-market-analysis/templates`.
- `GET /api/drafts/grouped` returns reports with their draft counts and top opportunity for client consumers.

#### Changed

- `GET /api/drafts` returns the new `angle`, `opportunitySignal`, `metadata` columns and accepts an optional `reportId` filter.

### [2026-05-01] Phase 5: Content pipeline split

#### Added

- Two-pass content drafts pipeline. `angle-picker.pipe` selects opportunities and platforms; `content-drafter.pipe` writes the drafts. Each pass is its own pipeline so the drafter only loads voice samples for platforms the picker chose.
- `pnpm run pipeline -- --content-only --report-id=<uuid>` re-runs content drafts against an existing report.
- New `content_drafts` columns: `angle`, `opportunity_signal`, `metadata` (JSONB), with index `(report_id, angle)` for the grouped UI.

#### Changed

- The drafter no longer produces drafts for all seven platforms by default. The picker chooses one or more angles, and for each angle picks the platforms that fit. Empty interpretations or zero-angle results skip the drafter cleanly.
- `ContentDraft` type adds `angle`, `opportunitySignal`, and `metadata`.

#### Removed

- `packages/apps/market-analysis/pipelines/content-drafts.pipe` (replaced by `angle-picker.pipe` + `content-drafter.pipe`).

### [2026-05-01] Phase 4: Report restructure

#### Added

- New report section structure: Executive Summary, Market Snapshot (replaces Market Landscape), Developer Signals (trimmed), Signal Interpretation (replaces Content Recommendations), Supporting Resources. Target render: roughly 1000 words, 5-minute read.
- `SignalInterpretationSection` carries 3-7 interpretations, each with `signal`, `meaning`, `implication`. The drafter (Phase 5) decides what to do with these.
- `SupportingResourcesSection` aggregates `research[]` entries from all sections, ranks them, and selects up to 10 with one-sentence "why" justifications.
- `ReportData.charts` snapshots `keywordDistribution` and `entityCentrality` data at generation time so rendering is stable across UI, email, and PDF paths.
- Server-side SVG chart helpers in `packages/web/lib/charts/`: `renderPieSvg`, `renderLineSvg`. Pure functions, inline-safe for `renderToStaticMarkup`, no runtime React or chart-library dependency.
- `LegacyReportTemplate` preserves pre-Phase-4 rendering verbatim. `ReportTemplate` dispatches via `isLegacyReportData(data)` so existing reports continue to render unchanged.

#### Changed

- `buildSystemPrompt(ctx)` adds a tone directive ("Write like one engineer telling another what they just saw in the data...") plus rules against hedging adjectives, chained statistics, and unsupported claims.
- `buildSectionPrompts(ctx)` returns the new section keys: `marketSnapshot`, `developerSignals`, `signalInterpretation`, `supportingResources`, `executiveSummary`.
- The trend-report pipeline now runs four passes: pass 1 (marketSnapshot, developerSignals), pass 2 (signalInterpretation), pass 3 (executiveSummary), pass 4 (supportingResources).
- Eval rubrics gain `signal_interpretation_present` (count 3-7) and `supporting_resources_present` (count <= 10) checks.

#### Removed

- Legacy section types (`MarketLandscapeSection`, `TechnologyTrendsSection`, `ContentRecommendationsSection`) and their data sub-types. Existing rows in the `reports` table use the legacy shape and continue to render via `LegacyReportTemplate`.
- Orphaned report components: `KeywordsChart.tsx`, `TechTable.tsx`, `ReportMetrics.tsx`. They referenced removed types and had no consumers.

### [2026-05-01] Phase 3: Analysis layer upgrades

#### Added

- `@pulsar/scraper/analytics` module: pure delta primitives (`compute12MonthDelta`, `computeYoYDelta`, `computeMultiYearTrajectory`), windowed history queries (`fetchEntityHistory`), and an entity enrichment helper (`enrichEntitiesWithHistory`) with soft-fail behavior so the pipeline never crashes on missing historical data.
- `EntityWithHistory` and `Trajectory` shared types. The pipeline attaches `history` (twelve-month delta, year-over-year delta, multi-year trajectory) to the top 20 entities by current-period centrality before they enter the section input.
- `GET /api/charts/entity-centrality?periods=12&top=5` returns time-series centrality from `graph_snapshots`; carries `meta.sparse: true` when fewer than the requested periods exist.
- `GET /api/charts/keyword-distribution?top=10&windowDays=30` returns top-N keyword counts with an `Other` aggregate, sourced from `articles.topic_tags`. Both endpoints are auth-protected via the existing middleware matcher.
- First tests under `packages/web/__tests__/` covering both new chart endpoints (sparse data, query-param parsing, edge cases).

#### Changed

- The pipeline runner fetches entity history for the top 20 entities and threads `EntityWithHistory[]` into section input. History-fetch failures are logged and the run continues with `history` undefined.

### [2026-05-01] Phase 2: Scraper backfill infrastructure

#### Added

- Historical backfill subsystem under `packages/scraper/backfill/` covering Wayback CDX (with rate limiting and disk cache under `.cache/wayback/`), per-source strategies (arxiv and hackernews via direct archive APIs, github via Search API, reddit/hashnode/medium/devto/rss via Wayback CDX), a Postgres-backed job queue, and a long-running worker process.
- `pnpm run backfill -- --source=<name> --from=YYYY-MM-DD --to=YYYY-MM-DD` for manual operator triggering.
- `pnpm run backfill-worker` long-running process. Holds advisory lock 73953 (separate from the scrape lock 73952) so backfill never blocks live scrapes.
- Auto-enqueue on first deploy: when `ENABLE_BACKFILL=true` and a source has fewer than 30 articles, the scheduler enqueues a full backfill from 2022-12-01 (ChatGPT release).
- Gap detection on every scheduler tick: per-source thresholds (reddit 7 days, arxiv 2 days, rss 14 days, etc.) trigger gap-fill backfill jobs automatically.
- Schema additions: `articles_raw.source_origin` (live, wayback, common_crawl, direct_archive), `articles_raw.composite_hash` (partial unique index), `articles_raw.backfill_run_id`, `backfill_runs` and `backfill_jobs` tables.
- Composite dedup hash via `hashComposite(sourceName, publishedAt, normalizedUrl)` lets backfill and live ingestion coexist on recent dates without collision.
- New shared types: `SourceOrigin`, `BackfillRun`, `BackfillJob`, `BackfillStatus`, `BackfillJobStatus`. `ScrapedItem` now carries optional `sourceOrigin` and `backfillRunId`.
- `env.backfill = { enabled, enableCommonCrawl, workerConcurrency }` config block. Controlled by `ENABLE_BACKFILL`, `ENABLE_COMMON_CRAWL`, `BACKFILL_WORKER_CONCURRENCY`.

#### Changed

- The scheduler runs gap detection and `maybeAutoEnqueue` after each scrape tick. Both are idempotent and short-circuit when the feature flag is off.
- Root `.gitignore` adds `.cache/` (Wayback cache directory).

### [2026-04-30] Phase 1: Apps framework

#### Added

- `packages/apps/` directory housing self-contained domain workflows.
- `@pulsar/app-market-analysis` workspace package containing the existing market-analysis pipelines, prompts, and UI.
- `app.config.ts` per-app configuration declaring schedule defaults, expected context fields, and render mode.
- `packages/apps/README.md` documenting the app contract and future-app scaffolds (technical-roadmap, financial-analysis, onboarding).

#### Changed

- `.pipe` files now live under `packages/apps/market-analysis/pipelines/` and are tracked in git (Postgres password templated to `${POSTGRES_PASSWORD}`).
- `packages/pipeline/runner.ts` imports prompts and pipelines from `@pulsar/app-market-analysis`.
- `packages/web/app/(dashboard)/drafts/page.tsx` is now a thin re-export shim; the implementation lives in `@pulsar/app-market-analysis/ui/drafts`.
- `pnpm-workspace.yaml` includes `packages/apps/*`.

### [2026-04-30] Phase 0: Configurable setup (voice + context)

#### Added

- Operator-agnostic configuration via `.voice/` and `.context/` directories. Both gitignored, generated at setup, read at runtime by the loader packages.
- `@pulsar/cli` package with `pulsar init`, `pulsar init --from-config <path>`, and `pulsar setup` entry points. Interactive flow uses `@inquirer/prompts`; non-interactive flow reads YAML.
- `@pulsar/voice` and `@pulsar/context` loader packages, consumed by pipelines via `loadVoiceContext(formats)` and `loadOperatorContext()`.
- Postinstall hook for interactive setup on a fresh clone. Skips cleanly in non-TTY environments, when installed as a transitive dependency, and when configuration already exists.
- `packages/cli/sample-config.rocketride.yaml` reflecting the prior hardcoded RocketRide values. Operators can rebuild that setup with `pulsar init --from-config packages/cli/sample-config.rocketride.yaml`.

#### Changed

- `packages/pipeline/trend-report-prompts.ts` now exports `buildSystemPrompt(ctx)` and `buildSectionPrompts(ctx)`. Identity, positioning, audience, hard rules, and grounding URLs are interpolated from `@pulsar/context` at runtime.
- `packages/pipeline/runner.ts` loads `loadOperatorContext()` once per run and threads it through every pass. Pipelines refuse to start with a clear error message when `.context/` is not configured.
- `packages/web/lib/auth.ts` reads the GitHub allowlist from `loadOperatorContext().allowedGitHubLogins`. When operator context is missing, the allowlist falls back to empty (no logins permitted) and a warning is logged.
