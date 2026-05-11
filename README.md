<p align="center">
  <img src="assets/banner.svg" alt="Pulsar" width="100%"/>
</p>

<div align="center">

_A market intelligence agent for developer ecosystems._

</div>

<p align="center">
  <a href="https://github.com/joshuadarron/pulsar/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/joshuadarron/pulsar/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white" alt="CI"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"/></a>
</p>

Pulsar is a market intelligence agent built on [RocketRide](https://github.com/rocketride-org/rocketride-server). It scrapes eight developer-focused sources on a daily schedule, runs the content through pipelines for trend analysis, and produces a daily trend report plus per-platform content drafts. It started as a weekend dogfood project for the content portion of my responsibilities. It is now used internally across three departments at RocketRide and is being prepped as a featured app on [RocketRide Cloud](https://rocketride.ai).

## Setup

1. Clone the repo.

   ```bash
   git clone https://github.com/joshuadarron/pulsar && cd pulsar
   ```

2. Install. The postinstall hook walks you through `.voice/` and `.context/`, then brings up Docker Compose, copies `.env.example` to `.env.local`, waits for Postgres, and runs the database migrations.

   ```bash
   pnpm install
   ```

3. Edit `.env.local` to fill in `ROCKETRIDE_APIKEY`, `ROCKETRIDE_ANTHROPIC_KEY`, and any other secrets, then start the dashboard.

   ```bash
   pnpm dev
   ```

If you ran step 2 with `--ignore-scripts`, run `pnpm setup` manually. For scripted setup, pass a YAML config: `pnpm exec pulsar init --from-config <path>`. The full walkthrough is in [`packages/cli/README.md`](packages/cli/README.md).

Pipelines do not hardcode operator-specific knowledge. `loadOperatorContext()` ([`@pulsar/context`](packages/context/README.md)) and `loadVoiceContext()` ([`@pulsar/voice`](packages/voice/README.md)) inject the operator's positioning and voice at runtime, so the same code base serves any operator.

Common commands:

| Command | Description |
|---|---|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm run scrape` | Run a manual full scrape |
| `pnpm run scrape -- --source=hackernews` | Scrape a single source |
| `pnpm run pipeline` | Run the active app's pipelines manually |
| `pnpm run scrape-scheduler` | Start the scheduler (scrape, then pipelines) |
| `pnpm run backfill-worker` | Start the historical-backfill worker (gated by `ENABLE_BACKFILL`) |
| `pnpm test` | Run the test suite |
| `pnpm typecheck` | Type-check every workspace |

## Requirements

Local prerequisites: Node.js 20+, pnpm, and Docker Compose. You also need a RocketRide server reachable at the `ROCKETRIDE_URI` you set in `.env.local`.

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), Tailwind, Recharts |
| Databases | PostgreSQL 16, Neo4j 5.x with Graph Data Science |
| AI runtime | [RocketRide](https://github.com/rocketride-org/rocketride-server) (WebSocket, pipelines as JSON) |
| LLM | Claude Sonnet (drafting + reasoning), Claude Haiku (eval scoring) |
| Sources | 8 free, public developer-focused feeds |
| Scheduling | node-cron |
| PDF | Puppeteer (server-side, on-demand) |
| Auth | NextAuth.js v5 (GitHub) |

The monorepo layout, app contract, and per-package READMEs live under [`packages/`](packages/). The first shipping app is [`packages/apps/market-analysis/`](packages/apps/market-analysis/README.md). To add another app, see [`packages/apps/README.md`](packages/apps/README.md).

## What it does

A scheduled run pulls from eight sources (Hacker News, Reddit, GitHub, arXiv, Hashnode, Dev.to, Medium, RSS), enriches and dedupes everything in Postgres, projects the graph into Neo4j, and hands a structured slice to the AI layer.

The trend report is a four-pass pipeline: market snapshot, developer signals, signal interpretations, then an executive summary stitched on top. The output is a single JSONB document that drives the dashboard, the daily email, and an on-demand PDF render.

The content drafter is two-pass. Pass 1 reads the finished report and picks one or more angles, each annotated with the platforms it should target. Pass 2 fans out across the chosen `(angle, platform)` pairs and writes a draft per pair: Hashnode, Medium, Dev.to, Hacker News, LinkedIn, Twitter, Discord. Operator voice samples are loaded only for the platforms the picker selected.

## Adoption

Marketing was the original use case. The trend reports drive the editorial calendar, and the platform drafts seed writing across LinkedIn, X, Medium, Hashnode, and other surfaces. Finance picked it up next, for external benchmarking: salary and equity comparisons against similar startups, funding-market tracking, and identifying geographic gaps in AI adoption. HR was the third, feeding Pulsar's outputs into an internal onboarding application that generates up-to-date new-hire briefs on mission, ICP, market standing, and tracked opportunities.

None of those use cases were the one I designed it for. They emerged from people seeing what the system produced and recognizing it could do more.

## Architecture

The runtime is RocketRide. The agent loop loads operator context once per pass and threads voice context through the drafters. The two-pass content design exists for a reason: it lets pass 1 stay lightweight (no per-format samples) and lets pass 2 inject samples only for the platforms the picker chose, which keeps each draft call's prompt tight.

Scraping is intentionally not in the runtime. It lives in the application layer as a TypeScript module, because scraping a known list of sources is a deterministic problem that does not need an agent. The principle: prepare deterministically, hand the AI layer only what needs non-determinism.

The graph layer runs Louvain community detection and PageRank over the developer-content graph using Neo4j Graph Data Science. The clusters and centrality scores feed directly into the trend report's signal-interpretation pass, so the model is reasoning over an already-summarized topology rather than raw edges.

The eval pipeline is three layers. Structural validators run deterministic checks on output shape and content (no em-dashes, word counts, code-fence integrity, schema conformance). LLM-graded scoring runs a Claude Haiku judge over each draft for qualitative quality. Retrospective grading runs after a 14-day window to score predictions against what actually played out, which feeds back into prompt iteration.

For the long-form story behind these decisions, the postmortem on three architectural wrong turns is in the Reading section below.

## Reading

The Pulsar Medium series is the canonical depth on the architecture and adoption story.

- **I Expected Pulsar to Land on the Repo Shelf. It Didn't.** How a weekend dogfood project ended up adopted by finance, HR, and marketing.
- **I Tried to Use My Own Product for Everything. I Had to Redesign Around Using It Where It Makes Sense.** Postmortem on three architectural wrong turns and the principle I should have started with.
- **The AI Layer Is Not Your Framework.** Where the runtime sits relative to orchestration frameworks, and why the architecture is shaped the way it is.
- **The Full Stack Is One Layer Deeper. You've Been Building It.** The thesis piece on the AI layer of the stack.

More pieces in the series are in flight, including a graph-database deep-dive. Index of everything I write: [joshuadarron.medium.com](https://joshuadarron.medium.com/).

## Status

Pulsar is in active internal use. It is being prepped as a featured public-facing application on [RocketRide Cloud](https://rocketride.ai), where anyone running the runtime can view it, run it, or fork it. The runtime itself is open source and MIT-licensed.

The codebase moves. The Medium series describes the system at the time each piece was written; if you are reading the code and find a delta, the code is the source of truth. More articles in the series are coming.

Maintained by [Joshua Phillips](https://github.com/joshuadarron).

## License

[MIT](LICENSE)
