# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### [2026-05-01] Phase 6: Drafts UI

#### Added

- New report-grouped drafts list at `/drafts`. Each card shows the report date, the top opportunity (derived from the first interpretation's `meaning`), and the count of drafts/platforms.
- New per-report viewer at `/drafts/<reportId>`. Drafts grouped by `angle`. Within each angle, platform tabs switch between four content tabs: Generated content, Steps to post, Voice transfer prompt, Topic refinement prompt. The viewer is server-rendered; only the tab switcher and copy-to-clipboard buttons are client-side.
- `packages/apps/market-analysis/templates/`: 7 post-step templates (one per platform) and 2 scoping prompt templates (voice-transfer, topic-refinement). Mustache-style placeholders.
- `@pulsar/app-market-analysis/templates` exports `fillPostSteps`, `fillVoiceTransferPrompt`, `fillTopicRefinementPrompt`, and `POST_STEP_PLATFORM_LIST`. The fill helpers are pure functions called from server components; they read templates once at module init via `readFileSync`.
- `GET /api/drafts/grouped` endpoint returns reports with their draft counts and top opportunity. The list page queries postgres directly instead of going through the endpoint, but the endpoint stays available for future client consumers.
- Web re-export shim at `packages/web/app/(dashboard)/drafts/[reportId]/page.tsx` matching the Phase 1 pattern.

#### Changed

- `packages/web/app/api/drafts/route.ts` GET now returns the new `angle`, `opportunityS ignal`, `metadata` columns and accepts an optional `reportId` filter.

### [2026-05-01] Phase 5: Content pipeline split

#### Added

- Two-pass content drafts pipeline: `angle-picker.pipe` selects opportunities and platforms; `content-drafter.pipe` writes the drafts. Each pass is its own RocketRide pipeline so the drafter only loads voice samples for platforms the picker chose.
- `packages/apps/market-analysis/prompts/content-drafts.ts` exports `buildAnglePickerSystemPrompt`, `buildAnglePickerUserPrompt`, `buildDrafterSystemPrompt`, `buildDrafterUserPrompt`, `voiceFormatForPlatform`, `PLATFORM_FORMAT_SPECS`, `ContentPlatform`, `AngleChoice`. All operator identity, voice profile/samples, and format specs are interpolated at runtime; the .pipe files carry no operator hardcoding.
- `packages/pipeline/lib/content-drafts-orchestrator.ts` is a pure dependency-injected two-pass orchestrator. Tests run without RocketRide or Postgres.
- `pnpm run pipeline -- --content-only --report-id=<uuid>` re-runs content drafts against an existing report. The CLI errors out clearly if the flags are mismatched.
- `content_drafts.angle`, `content_drafts.opportunity_signal`, and `content_drafts.metadata` (JSONB) columns. Index `(report_id, angle)` for the Phase 6 grouped UI. All nullable so existing rows stay valid.

#### Changed

- `packages/pipeline/runner.ts:runContentDrafts` is now a thin wrapper around the orchestrator. The Phase 4 transition shim (which translated `signalInterpretation` into the legacy `contentRecommendations` payload key) is removed.
- The drafter no longer produces drafts for ALL seven platforms by default. The picker chooses 1-N angles, and for each angle picks the platforms that fit. Empty interpretations or zero-angle results skip the drafter cleanly with a log line.
- `ContentDraft` type adds `angle`, `opportunitySignal`, and `metadata` fields.

#### Removed

- `packages/apps/market-analysis/pipelines/content-drafts.pipe`. Replaced by `angle-picker.pipe` + `content-drafter.pipe`.

### [2026-05-01] Phase 4: Report restructure

#### Added

- New report section structure: Executive Summary, Market Snapshot (replaces Market Landscape), Developer Signals (trimmed), Signal Interpretation (replaces Content Recommendations), Supporting Resources. Target render: ~1000 words, 5-minute read.
- `SignalInterpretationSection` carries 3-7 interpretations, each with `signal`, `meaning`, `implication` fields. The drafter (Phase 5) decides what to do with these.
- `SupportingResourcesSection` is a new pass-4 prompt that aggregates `research[]` entries from all sections, ranks them, and selects up to 10 with one-sentence "why" justifications.
- `ReportData.charts` snapshots `keywordDistribution` and `entityCentrality` data at generation time so rendering is stable across the UI, email, and PDF paths.
- Server-side SVG chart helpers in `packages/web/lib/charts/`: `renderPieSvg(slices, options)` and `renderLineSvg(series, options)`. Pure functions, inline-safe for `renderToStaticMarkup`. No runtime React or chart-library dependency.
- `LegacyReportTemplate` preserves pre-Phase-4 rendering verbatim. `ReportTemplate` dispatches via `isLegacyReportData(data)` so existing reports continue to render unchanged.

#### Changed

- `buildSystemPrompt(ctx)` now includes the tone directive: "Write like one engineer telling another what they just saw in the data..." plus rules against hedging adjectives, chained statistics, and unsupported claims.
- `buildSectionPrompts(ctx)` returns the new section keys: `marketSnapshot`, `developerSignals`, `signalInterpretation`, `supportingResources`, `executiveSummary`. The legacy keys (`marketLandscape`, `technologyTrends`, `contentRecommendations`) are removed.
- `packages/pipeline/runner.ts` now runs four passes: pass 1 (marketSnapshot, developerSignals), pass 2 (signalInterpretation), pass 3 (executiveSummary), pass 4 (supportingResources). Chart data is queried inline and persisted into `report_data.charts`.
- The eval rubrics (`TREND_REPORT_SUITE`) gain `signal_interpretation_present` (count 3-7) and `supporting_resources_present` (<= 10) checks.

#### Removed

- `MarketLandscapeSection`, `TechnologyTrendsSection`, `ContentRecommendationsSection`, `MarketLandscapeData`, `TechnologyTrendsData`, `DeveloperSignalsData` and the sub-types they referenced (`TrendingKeyword`, `TrendingTopic`, `TrendingTechnology`, `EntityProminence`, etc.). Existing rows in the `reports` table use the legacy shape and continue to render via `LegacyReportTemplate`.
- Orphaned report components: `KeywordsChart.tsx`, `TechTable.tsx`, `ReportMetrics.tsx`. They referenced removed types and had no consumers.

### [2026-05-01] Phase 3: Analysis layer upgrades

#### Added

- `@pulsar/scraper/analytics` module exports pure delta primitives (`compute12MonthDelta`, `computeYoYDelta`, `computeMultiYearTrajectory`), windowed history queries (`fetchEntityHistory`), and an entity enrichment helper (`enrichEntitiesWithHistory`) with soft-fail behavior so the pipeline never crashes on missing historical data.
- `EntityWithHistory` and `Trajectory` shared types in `@pulsar/shared/types`. The pipeline now attaches `history` (twelve-month delta, year-over-year delta, multi-year trajectory) to the top 20 entities by current-period centrality before they enter the marketLandscape section input.
- `GET /api/charts/entity-centrality?periods=12&top=5` returns time-series centrality for the top entities, sourced from `graph_snapshots` rows. Response carries `meta.sparse: true` when fewer than the requested periods exist.
- `GET /api/charts/keyword-distribution?top=10&windowDays=30` returns top-N keyword counts with an `Other` aggregate, sourced from `articles.topic_tags`. Both endpoints are auth-protected via the existing middleware matcher.
- Web package tests: first tests under `packages/web/__tests__/` cover both new chart endpoints (sparse data, query-param parsing, edge cases).

#### Changed

- `packages/pipeline/runner.ts` now loads operator context once, fetches entity history for the top 20 entities, and threads `EntityWithHistory[]` into section input. Failures in the history fetch are logged and the run continues with `history` undefined.

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
