# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Pulsar — Automated market intelligence and content agent. Scrapes free developer sources, runs AI analysis via RocketRide, and outputs trend reports + content drafts for human review. Full PRD at `.claude/PRD.md`.

## Stack

- **Runtime:** Node.js 20+, pnpm
- **Framework:** Next.js 15 (App Router)
- **Databases:** PostgreSQL 16 + Neo4j 5.x (Docker Compose)
- **AI:** RocketRide (WebSocket on port 5565, pipelines as JSON)
- **Auth:** NextAuth.js v5 (Google + GitHub)
- **Charts:** Recharts
- **PDF:** Puppeteer (server-side, on-demand)
- **Styling:** Tailwind CSS
- **Scheduling:** node-cron

## Commands

```bash
docker-compose up -d          # Start PostgreSQL + Neo4j
pnpm install                  # Install dependencies
pnpm dev                      # Start Next.js dev server
pnpm run scrape               # Manual full scrape
pnpm run scrape --source=X    # Scrape single source (hackernews, reddit, etc.)
pnpm run pipeline-scheduler   # Start the 04:00 RocketRide pipeline scheduler
pnpm run db:migrate           # Run database migrations
```

## Architecture

Three independent processes:
1. **Scraper** (`scraper/`) — Programmatic data collection, no AI. Runs at 00:00 and 12:00. Writes raw data to PostgreSQL, graph relationships to Neo4j.
2. **Pipeline Scheduler** (`pipeline-scheduler/`) — Triggers three RocketRide pipelines sequentially at 04:00 via WebSocket: summarization → trend-report → content-drafts. Sends email notification after completion.
3. **Next.js App** (`app/`) — UI and API routes. Renders reports from `report_data` JSONB, serves PDF export via Puppeteer.

## Key Patterns

- **Source adapters** (`scraper/sources/`) — Each source is a self-contained adapter implementing `SourceAdapter = () => Promise<ScrapedItem[]>`. Register new sources in `scraper/sources/index.ts`.
- **Dedup** — SHA-256 hash of canonical URL, checked against `articles_raw.url_hash` before insert.
- **Config** — All env vars read through `config/env.ts`. Source lists and scraper config in `config/sources.ts`.
- **Report rendering** — Single `report_data` JSONB column is the source of truth for UI, email, and PDF. UI renders charts natively; email uses tables/lists only; PDF is Puppeteer rendering the UI with `?print=true`.
- **RocketRide pipelines** — Defined as JSON in `pipelines/`. The runner (`pipeline-scheduler/runner.ts`) sends them over WebSocket and awaits completion acks.
