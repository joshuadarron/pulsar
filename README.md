<p align="center">
  <img src="assets/banner.svg" alt="Pulsar — Automated AI Market Intelligence & Content Agent" width="100%"/>
</p>

# Pulsar

Automated AI market intelligence and content agent. Scrapes free developer sources twice daily, runs AI analysis via RocketRide pipelines, and outputs trend reports + content drafts for human review.

## Architecture

Three independent processes:

1. **Scraper** — Programmatic data collection from 8 sources (no AI). Runs at 00:00 and 12:00. Writes raw data to PostgreSQL, graph relationships to Neo4j.
2. **Pipeline Scheduler** — Triggers three RocketRide AI pipelines sequentially at 04:00: summarization → trend-report → content-drafts. Sends email notification after completion.
3. **Next.js App** — Dashboard UI with report visualization, article feed, graph explorer, content drafts review, and on-demand PDF export.

```
Scraper (00:00, 12:00)          Pipeline Scheduler (04:00)
       |                                |
       v                                v
  +---------+                   +---------------+
  | HN      |                   | RocketRide    |
  | Reddit  |  -> PostgreSQL <- | (Claude LLM)  |
  | GitHub  |  -> Neo4j         |               |
  | ArXiv   |                   | summarize     |
  | Hashnode |                   | trend-report  |
  | Dev.to  |                   | content-drafts|
  | Medium  |                   +-------+-------+
  | RSS     |                           |
  +---------+                     Email + Report
                                        |
                                        v
                                  Next.js UI
                               (charts, PDF, drafts)
```

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+, pnpm |
| Framework | Next.js 15 (App Router) |
| Databases | PostgreSQL 16 + Neo4j 5.x (Docker Compose) |
| AI | RocketRide (Claude Sonnet 4.6 via `llm_anthropic`) |
| Auth | NextAuth.js v5 (Google + GitHub) |
| Charts | Recharts |
| PDF | Puppeteer (server-side, on-demand) |
| Styling | Tailwind CSS |
| Scheduling | node-cron |

## Data Sources

All free, no API keys required for scraping:

- **Hacker News** — Algolia Search API
- **Reddit** — JSON API (12 subreddits)
- **GitHub** — REST Search API (trending repos)
- **ArXiv** — Atom feed (cs.AI, cs.LG, cs.CL, cs.SE)
- **Hashnode** — Public GraphQL API
- **Dev.to** — Public REST API
- **Medium** — RSS tag feeds
- **RSS/Substack** — Configurable feed list

## Setup

### Prerequisites

- Node.js 20+
- pnpm
- Docker + Docker Compose
- RocketRide runtime (port 5565)

### 1. Start databases

```bash
docker-compose up -d
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

```bash
cp .env.example .env.local
```

Fill in:
- `ROCKETRIDE_APIKEY` and `ROCKETRIDE_ANTHROPIC_KEY` for AI pipelines
- `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` for auth
- `SMTP_*` and `NOTIFY_EMAIL_TO` for email notifications

### 4. Run database migrations

```bash
pnpm run db:migrate
```

### 5. Run initial scrape

```bash
pnpm run scrape
```

### 6. Start the app

```bash
pnpm dev
```

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start Next.js dev server |
| `pnpm run scrape` | Manual full scrape (all sources) |
| `pnpm run scrape --source=hackernews` | Scrape a single source |
| `pnpm run pipeline-scheduler` | Start the 04:00 pipeline scheduler |
| `pnpm run db:migrate` | Run database migrations |
| `pnpm build` | Production build |

## Project Structure

```
app/                    Next.js App Router pages + API routes
  (dashboard)/          Authenticated dashboard pages
    page.tsx            Dashboard overview
    reports/            Report list + detail with charts
    drafts/             Content drafts review
    feed/               Article feed with filters
    explore/            Force-directed graph explorer
    runs/               Run history log
    settings/           Source config + manual triggers
  api/                  REST API endpoints
  login/                OAuth login page
components/
  report/               Recharts visualization components
  Sidebar.tsx           Navigation sidebar
scraper/
  sources/              Source adapters (one per platform)
  dedup.ts              SHA-256 URL deduplication
  extract.ts            Keyword + entity extraction
  graph-writer.ts       Neo4j graph writer
  trend-scorer.ts       Exponential decay trend scoring
pipelines/              RocketRide .pipe definitions
  summarization.pipe    Article enrichment pipeline
  trend-report.pipe     Trend analysis pipeline
  content-drafts.pipe   Content generation pipeline
pipeline-scheduler/     AI pipeline orchestrator
  runner.ts             Sequential pipeline execution
  notify.ts             HTML email notification
config/
  env.ts                Centralized env var config
  sources.ts            Source lists + entity dictionary
lib/
  db/                   PostgreSQL + Neo4j clients + migrations
  auth.ts               NextAuth configuration
  rocketride.ts         RocketRide SDK wrapper
  retry.ts              Exponential backoff retry utility
types/                  Shared TypeScript interfaces
```

## Adding a New Source

1. Create `scraper/sources/mysource.ts` implementing `SourceAdapter`:

```typescript
import type { SourceAdapter, ScrapedItem } from "./types";

export const mysource: SourceAdapter = async () => {
  // Fetch and return ScrapedItem[]
};
```

2. Register it in `scraper/sources/index.ts`:

```typescript
import { mysource } from "./mysource";

export const sources = {
  // ...existing sources
  mysource,
};
```

3. Run with `pnpm run scrape --source=mysource`.

## AI Pipelines

Three RocketRide pipelines run sequentially at 04:00:

1. **Summarization** — Enriches unenriched articles with summary, content type, sentiment, topic tags, and entity mentions via Claude.
2. **Trend Report** — Aggregates Neo4j trend data + PostgreSQL keyword frequencies, sends to Claude for narrative analysis. Saves structured report JSON.
3. **Content Drafts** — Takes the report + top articles, generates drafts for 7 platforms (Hashnode, Medium, Dev.to, HN, LinkedIn, X, Discord).

## Report Rendering

The `report_data` JSONB column is the single source of truth:

- **UI** — Full native rendering with Recharts (bar charts, donut, heatmap, sparklines, tables)
- **Email** — HTML with inline styles, top 5 keywords/topics, link to full report
- **PDF** — Puppeteer renders `/reports/:id?print=true` with print-optimized CSS

## License

MIT
