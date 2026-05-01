<p align="center">
  <img src="assets/banner.svg" alt="Pulsar" width="100%"/>
</p>

<div align="center">

_Configurable agent framework for market intelligence, content drafting, and other domain workflows. Scrapes free public sources, runs AI analysis, and outputs structured reports plus content drafts for human review._

</div>

<p align="center">
  <a href="https://github.com/JoshuaDarron/pulsar/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/JoshuaDarron/pulsar/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white" alt="CI"/></a>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16"/>
  <img src="https://img.shields.io/badge/Neo4j-5.x-008CC1?logo=neo4j&logoColor=white" alt="Neo4j 5.x"/>
</p>

## What Pulsar is

Pulsar is a configurable agent framework. The core (scheduler, scraper, analysis, content drafter, web app) is shared. Domain-specific workflows live as self-contained apps under `packages/apps/`. Each app owns its pipelines, prompts, output schema, and UI.

The first shipping app is [`market-analysis/`](packages/apps/market-analysis/README.md): a daily scrape of free developer sources (Hacker News, Reddit, GitHub, arXiv, Hashnode, Dev.to, Medium, RSS), a multi-pass trend report, and per-platform content drafts. See [`packages/apps/README.md`](packages/apps/README.md) for the full app contract and how to add another app.

## Setup

Prerequisites: Node.js 20+, pnpm, Docker + Docker Compose, and an AI pipeline engine reachable on the `ROCKETRIDE_URI` you set in `.env.local`.

```bash
git clone https://github.com/JoshuaDarron/pulsar && cd pulsar
docker-compose up -d
pnpm install
cp .env.example .env.local
pnpm run db:migrate
pnpm run scrape
pnpm dev
```

`pnpm install` triggers an interactive operator setup the first time it runs. The hook walks you through `.voice/` (how you write) and `.context/` (your org's positioning, audience, hard rules, allowed GitHub logins). Both directories are gitignored.

The hook is silent in three cases:

- Non-TTY environments (CI, Docker builds): it prints a skip message and exits 0.
- Pulsar installed as a transitive dependency: it does nothing.
- Already configured (`.voice/` and `.context/` both exist): it prints a notice and exits 0.

If you ran `pnpm install --ignore-scripts`, run setup manually:

```bash
pnpm setup
```

For CI/CD or scripted setup, pass a YAML config:

```bash
pnpm exec pulsar init --from-config path/to/your-config.yaml
```

A worked example config lives at `packages/cli/sample-config.rocketride.yaml`. Operators can rebuild it verbatim with `pulsar init --from-config packages/cli/sample-config.rocketride.yaml`. To wipe and redo setup, add `--reconfigure`.

The full YAML schema, the file shapes written under `.voice/` and `.context/`, and the operator-onboarding walkthrough live in [`packages/cli/README.md`](packages/cli/README.md).

## Configuration loading

Pipelines do not hardcode operator-specific knowledge. Two pure-read loaders inject the operator's voice and context at runtime:

- `loadOperatorContext()` from [`@pulsar/context`](packages/context/README.md) returns positioning, audience, hard rules, glossary, tracked entities, allowed GitHub logins, and grounding URLs from `.context/`.
- `loadVoiceContext(formats)` from [`@pulsar/voice`](packages/voice/README.md) returns tone rules and up to three writing samples per requested format from `.voice/`.

Both directories are operator-supplied and gitignored. Default locations are `.context/` and `.voice/` at the repo root. Override with `PULSAR_CONTEXT_DIR` and `PULSAR_VOICE_DIR` environment variables.

If `.context/profile.md` or `.voice/profile.md` is missing, the loaders throw `OperatorContextNotConfiguredError` or `VoiceContextNotConfiguredError`. The pipeline runner refuses to start without a configured operator context. Run `pnpm setup` to generate the required files.

## Architecture

Three processes plus one web app:

1. **Scheduler** (`packages/scraper/scheduler.ts`): runs daily at 05:30. Scrapes all sources, then triggers the active app's pipelines (for `market-analysis`: trend-report, content-drafts, email notification) in sequence. When `ENABLE_BACKFILL=true`, it also detects gaps and enqueues historical-backfill jobs.
2. **Pipeline runner** (`packages/pipeline/runner.ts`): loads `.pipe` files from the active app under `packages/apps/<app>/pipelines/`, threads operator and voice context into every pass, and sends the pipelines to the AI pipeline engine over WebSocket. The trend report runs in four passes; content drafts run as a two-pass design (angle picker, then drafter).
3. **Backfill worker** (`packages/scraper/backfill/worker.ts`, optional): long-running process that walks Wayback CDX (and per-source archives) to fill `articles_raw` back to 2022-12-01. Holds its own Postgres advisory lock so it never blocks the live scrape. See [`packages/scraper/backfill/README.md`](packages/scraper/backfill/README.md).
4. **Next.js web app** (`packages/web/`): dashboard for reports, article feed, graph explorer, content drafts review, and on-demand PDF export. Apps re-export their UI components through thin shims under `packages/web/app/(dashboard)/` so the URLs stay stable.

The single `report_data` JSONB column is the source of truth for UI, email, and PDF rendering. Charts are pre-snapshotted into `report_data.charts` at generation time so the three render paths stay consistent.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+, pnpm (workspaces) |
| Web framework | Next.js 15 (App Router) |
| Databases | PostgreSQL 16 + Neo4j 5.x (Docker Compose) |
| AI | RocketRide (WebSocket on port 5565, pipelines as JSON), Claude Sonnet 4.6 via `llm_anthropic` |
| Auth | NextAuth.js v5 (GitHub) |
| Charts | Recharts (UI), inline SVG helpers (email/PDF) |
| PDF | Puppeteer (server-side, on-demand) |
| Styling | Tailwind CSS |
| Scheduling | node-cron |

## Monorepo structure

```
packages/
  shared/               @pulsar/shared              Config, DB clients, types, utilities
  scraper/              @pulsar/scraper             Data collection process (with optional backfill subsystem)
  pipeline/             @pulsar/pipeline            AI pipeline runner
  voice/                @pulsar/voice               Voice profile + sample loader
  context/              @pulsar/context             Operator context loader
  cli/                  @pulsar/cli                 Setup CLI (pulsar init, pulsar setup, postinstall hook)
  web/                  @pulsar/web                 Next.js app (UI + API routes)
  apps/
    market-analysis/    @pulsar/app-market-analysis Trend report + content drafts app (pipelines, prompts, UI)
```

## Commands

| Command | Description |
|---|---|
| `pnpm install` | Install workspace dependencies. Triggers interactive setup on first run. |
| `pnpm setup` | Run interactive operator setup manually (fallback for `--ignore-scripts`). Add `--reconfigure` to wipe `.voice/` and `.context/` first. |
| `pnpm dev` | Start the Next.js dev server. |
| `pnpm run scrape` | Manual full scrape (all sources). |
| `pnpm run scrape -- --source=hackernews` | Scrape a single source. |
| `pnpm run pipeline` | Manual pipeline run. Loads `.pipe` files from the active app. |
| `pnpm run pipeline -- --content-only --report-id=<uuid>` | Re-run content drafts against an existing report. |
| `pnpm run scrape-scheduler` | Start the scheduler (scrape at 05:30, pipeline after). |
| `pnpm run backfill -- --source=<name> --from=YYYY-MM-DD --to=YYYY-MM-DD` | Manually enqueue a historical backfill job. |
| `pnpm run backfill-worker` | Start the long-running backfill worker. |
| `pnpm run db:migrate` | Run database migrations. |
| `pnpm build` | Production build. |
| `pnpm test` | Run the test suite. |
| `pnpm typecheck` | Type-check every workspace. |

## Adding a new source

1. Create `packages/scraper/sources/mysource.ts` implementing `SourceAdapter`:

```typescript
import type { SourceAdapter, ScrapedItem } from "@pulsar/shared/types";

export const mysource: SourceAdapter = async () => {
  // Fetch and return ScrapedItem[]
};
```

2. Register it in `packages/scraper/sources/index.ts`.
3. Run with `pnpm run scrape -- --source=mysource`.

## Adding a new app

See [`packages/apps/README.md`](packages/apps/README.md) for the app contract, the directory layout, and the steps to scaffold a new app.

## License

[MIT](LICENSE)
