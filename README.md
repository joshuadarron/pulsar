<p align="center">
  <img src="assets/banner.svg" alt="Pulsar — Market Intelligence Agent" width="100%"/>
</p>

```bash
git clone https://github.com/JoshuaDarron/pulsar && cd pulsar
docker-compose up -d              # PostgreSQL + Neo4j
pnpm install                      # dependencies
cp .env.example .env.local        # configure secrets (see below)
pnpm run db:migrate               # create tables
pnpm run scrape                   # initial data collection
pnpm dev                          # http://localhost:3000
```

Automated market intelligence agent. Scrapes free developer sources, runs AI analysis via RocketRide pipelines, and outputs trend reports + content drafts for human review.

## Setup

### Prerequisites

- Node.js 20+
- pnpm
- Docker + Docker Compose
- RocketRide runtime (port 5565)

### Environment

```bash
cp .env.example .env.local
```

Fill in:
- `ROCKETRIDE_APIKEY` and `ROCKETRIDE_ANTHROPIC_KEY` for AI pipelines
- `NEXTAUTH_SECRET`, `GITHUB_CLIENT_ID/SECRET` for auth
- `SMTP_*` and `NOTIFY_EMAIL_TO` for email notifications

## Architecture

Two processes + web app:

1. **Scheduler** — Runs daily at 05:30. Scrapes all sources, then triggers the pipeline (trend-report, content-drafts, email notification) sequentially.
2. **Pipeline** — RocketRide AI pipelines. Five-section trend report generated in three passes, then content drafts for 7 platforms.
3. **Next.js App** — Dashboard UI with report visualization, article feed, graph explorer, content drafts review, and on-demand PDF export.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+, pnpm |
| Framework | Next.js 15 (App Router) |
| Databases | PostgreSQL 16 + Neo4j 5.x (Docker Compose) |
| AI | RocketRide (Claude Sonnet 4.6 via `llm_anthropic`) |
| Auth | NextAuth.js v5 (GitHub) |
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

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start Next.js dev server |
| `pnpm run scrape` | Manual full scrape (all sources) |
| `pnpm run scrape -- --source=hackernews` | Scrape a single source |
| `pnpm run pipeline` | Manual pipeline run |
| `pnpm run scrape-scheduler` | Start scheduler (scrape at 5:30am, pipeline after) |
| `pnpm run db:migrate` | Run database migrations |
| `pnpm build` | Production build |

## Monorepo Structure

```
packages/
  shared/     @pulsar/shared    — Config, DB clients, types, utilities
  scraper/    @pulsar/scraper   — Data collection process
  pipeline/   @pulsar/pipeline  — AI analysis & report generation
  web/        @pulsar/web       — Next.js app (UI + API routes)
```

## Adding a New Source

1. Create `packages/scraper/sources/mysource.ts` implementing `SourceAdapter`:

```typescript
import type { SourceAdapter, ScrapedItem } from "@pulsar/shared/types";

export const mysource: SourceAdapter = async () => {
  // Fetch and return ScrapedItem[]
};
```

2. Register it in `packages/scraper/sources/index.ts`.
3. Run with `pnpm run scrape -- --source=mysource`.

## Report Pipeline

The trend-report agent runs in three passes:

1. **Pass 1** — Market landscape, technology trends, developer signals. Each section receives its own data slice and writes analytical text + optional research citations.
2. **Pass 2** — Content recommendations. Reads pass 1 text outputs only. Produces prioritized content ideas for the downstream content-drafts pipeline.
3. **Pass 3** — Executive summary. Reads all four prior text outputs. 3-5 sentence synthesis for executives.

The `report_data` JSONB column is the single source of truth:

- **UI** — Full native rendering with Recharts
- **Email** — HTML with inline styles, key metrics, section summaries
- **PDF** — Puppeteer renders `/reports/:id?print=true` with print-optimized CSS

## License

[MIT](LICENSE)
