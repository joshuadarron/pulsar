<p align="center">
  <img src="assets/banner.svg" alt="Pulsar" width="100%"/>
</p>

<div align="center">

_Automated market intelligence agent. Scrapes free developer sources, runs AI analysis via RocketRide pipelines, and outputs trend reports + content drafts for human review._

</div>

<p align="center">
  <a href="https://github.com/JoshuaDarron/pulsar/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/JoshuaDarron/pulsar/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white" alt="CI"/></a>
  <img src="https://img.shields.io/badge/RocketRide-8B5CF6?logo=rocket&logoColor=white" alt="RocketRide"/>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16"/>
  <img src="https://img.shields.io/badge/Neo4j-5.x-008CC1?logo=neo4j&logoColor=white" alt="Neo4j 5.x"/>
</p>

## Apps

Pulsar is structured as a configurable agent framework. The Pulsar core
(scheduler, scraper, analysis, content drafter) is shared, and domain-specific
workflows live as self-contained apps under `packages/apps/`.

The current shipping app is [`market-analysis/`](packages/apps/market-analysis/README.md),
which generates a weekly developer-market trend report and per-platform
content drafts. Future apps (technical roadmap, financial analysis,
onboarding) live alongside it under the same contract.

See [`packages/apps/README.md`](packages/apps/README.md) for the full app
contract and the directory layout each app must follow.

## Setup

### Prerequisites

- Node.js 20+
- pnpm
- Docker + Docker Compose
- RocketRide

### Steps

1. Clone the repo
```bash
git clone https://github.com/JoshuaDarron/pulsar && cd pulsar
```

2. Start PostgreSQL and Neo4j
```bash
docker-compose up -d
```

3. Install dependencies (also runs interactive operator setup)
```bash
pnpm install
```

The `pnpm install` postinstall hook walks you through configuring `.voice/` (how you write) and `.context/` (your org's positioning, audience, hard rules, allowed GitHub logins). Both directories are gitignored. Skip rules:

- Non-TTY environments (CI, Docker builds): the hook prints a skip message and exits 0.
- Pulsar installed as a transitive dependency: the hook is silent.
- Already configured (`.voice/` and `.context/` both exist): the hook prints a notice and exits 0.

If you run `pnpm install --ignore-scripts`, postinstall is skipped entirely. Run setup manually with:

```bash
pnpm setup
```

For CI/CD or scripted setup, pass a YAML config file:

```bash
pnpm exec pulsar init --from-config packages/cli/sample-config.rocketride.yaml
# or any operator-specific YAML
pnpm exec pulsar init --from-config path/to/your-config.yaml
```

To wipe and redo setup, add `--reconfigure`:

```bash
pnpm setup --reconfigure
```

See `packages/cli/README.md` for the full YAML schema and the file shapes written under `.voice/` and `.context/`.

4. Create your environment file
```bash
cp .env.example .env.local
```

5. Run database migrations
```bash
pnpm run db:migrate
```

6. Run initial data collection
```bash
pnpm run scrape
```

7. Start the app
```bash
pnpm dev
```

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
| `pnpm run pipeline` | Manual pipeline run (loads `.pipe` files from `packages/apps/market-analysis/pipelines/`) |
| `pnpm run scrape-scheduler` | Start scheduler (scrape at 5:30am, pipeline after) |
| `pnpm run db:migrate` | Run database migrations |
| `pnpm build` | Production build |

## Monorepo Structure

```
packages/
  shared/                  @pulsar/shared              Config, DB clients, types, utilities
  scraper/                 @pulsar/scraper             Data collection process
  pipeline/                @pulsar/pipeline            AI pipeline runner
  voice/                   @pulsar/voice               Voice profile + sample loader
  context/                 @pulsar/context             Operator context loader
  web/                     @pulsar/web                 Next.js app (UI + API routes)
  apps/
    market-analysis/       @pulsar/app-market-analysis Trend report + content drafts app (pipelines, prompts, UI)
```

## Configuration loading

Pipelines do not hardcode operator-specific knowledge. Two pure-read loaders
inject the operator's voice and context at runtime:

- `loadOperatorContext()` from `@pulsar/context` returns positioning,
  audience, hard rules, glossary, tracked entities, allowed GitHub logins, and
  grounding URLs from `.context/`.
- `loadVoiceContext(formats)` from `@pulsar/voice` returns tone rules and up
  to three writing samples per requested format from `.voice/`.

Both directories are operator-supplied and gitignored. The defaults live at
`.context/` and `.voice/` under the repo root. Override the locations with
the `PULSAR_CONTEXT_DIR` and `PULSAR_VOICE_DIR` environment variables.

If `.context/profile.md` or `.voice/profile.md` is missing, the loaders throw
`OperatorContextNotConfiguredError` or `VoiceContextNotConfiguredError`. The
pipeline runner refuses to start without a configured operator context. Run
`pnpm setup` to generate the required files.

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
