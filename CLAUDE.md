# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Pulsar is a configurable agent framework. The core (scheduler, scraper, analysis, content drafter, web app) is shared. Domain-specific workflows live as self-contained apps under `packages/apps/`. The first shipping app is `market-analysis`, which scrapes free public developer sources, runs AI analysis via RocketRide, and outputs a multi-pass trend report plus per-platform content drafts. Operator-specific knowledge (positioning, audience, hard rules, voice samples, allowed GitHub logins) is loaded at runtime from `.context/` and `.voice/`. Both directories are gitignored. Full PRD at `.claude/PRD.md`.

## Stack

- **Runtime:** Node.js 20+, pnpm (workspaces)
- **Framework:** Next.js 15 (App Router)
- **Databases:** PostgreSQL 16 + Neo4j 5.x (Docker Compose)
- **AI:** RocketRide (WebSocket on port 5565, pipelines as JSON), Claude Sonnet 4.6 via `llm_anthropic`
- **Auth:** NextAuth.js v5 (GitHub). Allowlist comes from `.context/profile.md` `allowedGitHubLogins`.
- **Charts:** Recharts in the UI, inline SVG helpers in email/PDF
- **PDF:** Puppeteer (server-side, on-demand)
- **Styling:** Tailwind CSS
- **Scheduling:** node-cron

## Monorepo Structure

```
packages/
  shared/               @pulsar/shared              Config, DB clients, types, utilities
  scraper/              @pulsar/scraper             Data collection (with optional backfill subsystem)
  pipeline/             @pulsar/pipeline            AI pipeline runner
  voice/                @pulsar/voice               Voice profile + sample loader
  context/              @pulsar/context             Operator context loader
  cli/                  @pulsar/cli                 Setup CLI (pulsar init, pulsar setup, postinstall hook)
  web/                  @pulsar/web                 Next.js app (UI + API routes)
  apps/
    market-analysis/    @pulsar/app-market-analysis Trend report + content drafts app
```

## Commands

```bash
docker-compose up -d              # Start PostgreSQL + Neo4j
pnpm install                      # Install workspace deps; triggers interactive setup on first run
pnpm setup                        # Manual setup if --ignore-scripts was used (add --reconfigure to wipe)
pnpm dev                          # Start Next.js dev server
pnpm run scrape                   # Manual full scrape
pnpm run scrape -- --source=X     # Scrape a single source (hackernews, reddit, etc.)
pnpm run pipeline                 # Manual pipeline run; loads .pipe files from the active app
pnpm run scrape-scheduler         # Start scheduler (scrape 05:30, pipeline after)
pnpm run backfill-worker          # Start the historical-backfill worker (gated by ENABLE_BACKFILL)
pnpm run db:migrate               # Run database migrations
```

## Architecture

Three processes plus one web app:

1. **Scheduler** (`packages/scraper/scheduler.ts`): runs daily at 05:30. Scrapes all sources, then triggers the active app's pipelines (for `market-analysis`: trend-report, content-drafts, email notification) in sequence. When `ENABLE_BACKFILL=true`, it also detects gaps and auto-enqueues historical backfill jobs.
2. **Pipeline runner** (`packages/pipeline/runner.ts`): loads `.pipe` files from the active app under `packages/apps/<app>/pipelines/`, loads operator context once via `loadOperatorContext()`, threads voice context per pipeline via `loadVoiceContext()`, and sends pipelines to RocketRide over WebSocket. The trend report runs in four passes; content drafts run as a two-pass angle-picker + drafter design.
3. **Backfill worker** (`packages/scraper/backfill/worker.ts`, optional): long-running process that walks Wayback CDX and per-source archives to fill `articles_raw` back to 2022-12-01. Holds Postgres advisory lock 73953, separate from the scrape lock 73952, so it never blocks live scrapes.
4. **Next.js web app** (`packages/web/`): dashboard for reports, article feed, graph explorer, content drafts review, on-demand PDF export. Apps re-export their UI components through thin shims under `packages/web/app/(dashboard)/` so the URLs stay stable across app refactors.

Shared code lives in `packages/shared/` and is consumed via `@pulsar/shared` subpath exports (for example `@pulsar/shared/db/postgres`, `@pulsar/shared/types`).

## Key Patterns

- **Apps contract** (`packages/apps/README.md`): each app under `packages/apps/<name>/` is self-contained (pipelines, prompts, schemas, UI, `app.config.ts`). The Pulsar core is shared and operator-agnostic. Apps declare what `.context/` and `.voice/` fields they expect; missing required fields fail fast at startup.
- **Operator config loaders**: `loadOperatorContext()` (`@pulsar/context`) and `loadVoiceContext()` (`@pulsar/voice`) are pure-read. Pipelines never read `.voice/` or `.context/` directly. Prompts interpolate operator identity, positioning, hard rules, and grounding URLs at runtime, so the same code base serves any operator.
- **Source adapters** (`packages/scraper/sources/`): each source is a self-contained adapter implementing `SourceAdapter = () => Promise<ScrapedItem[]>`. Register new sources in `packages/scraper/sources/index.ts`.
- **Dedup**: SHA-256 hash of canonical URL, checked against `articles_raw.url_hash` before insert. Backfill uses an additional composite hash (`hashComposite(sourceName, publishedAt, normalizedUrl)`) so live and archived ingestion can coexist on overlapping dates without collision.
- **Env config**: all env vars read through `@pulsar/shared/config/env`. Source lists and scraper config in `@pulsar/shared/config/sources`.
- **Report rendering**: the single `report_data` JSONB column is the source of truth for UI, email, and PDF. Charts are pre-snapshotted into `report_data.charts` at generation time so the three render paths stay consistent. UI uses Recharts; email and PDF use inline SVG via `packages/web/lib/charts/`.
- **Legacy report compatibility**: `LegacyReportTemplate` preserves the pre-Phase-4 rendering verbatim. `ReportTemplate` dispatches via `isLegacyReportData(data)` so historical reports still render unchanged.
- **RocketRide pipelines**: defined as JSON `.pipe` files under `packages/apps/<app>/pipelines/`. The runner sends them over WebSocket and awaits completion acks. Prompt templates live under the same app's `prompts/` directory (for market-analysis: `prompts/trend-report.ts`, `prompts/content-drafts.ts`).

## Hard Rules

- **No em-dashes anywhere.** Code, prompts, comments, docs, generated content. Use commas, colons, periods, parentheses.
- **Operator-agnostic core.** Do not hardcode "RocketRide", "Joshua", or any one operator's positioning into shared code. Operator values live in `.context/` and `.voice/`.
- **Feature flags for new pipelines.** Keep the existing scrape-then-pipeline cron path green during migrations.
- **`pnpm typecheck` and `pnpm test` must pass after every change.**
