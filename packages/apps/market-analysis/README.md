# @pulsar/app-market-analysis

The market-analysis app tracks developer-market trends across free public
sources (Hacker News, Reddit, GitHub, arXiv, Hashnode, Dev.to, Medium, RSS),
runs AI analysis over the resulting graph, generates a weekly trend report,
and produces content drafts ready for human review. It is the first app
shipped on Pulsar and the reference implementation of the apps contract.

## Pipelines

| Pipeline | When it runs | What it does |
|---|---|---|
| `trend-report` | Daily at 05:30 (after the scheduled scrape completes) | Three-pass report generation. Pass 1 writes Market Snapshot, Developer Signals, and supporting analytical sections. Pass 2 produces signal interpretations. Pass 3 writes the executive summary. |
| `content-drafts` | Chained after `trend-report` | Reads the completed report, picks angles from its signal interpretations, and writes per-platform drafts using the operator's voice samples. |
| `evaluation` | On demand or after each report | Scores the report against a checklist (hard rules respected, claims grounded in `research[]`, no banned phrasing). |
| `retrospective` | Weekly | Aggregates report and content metrics over the prior period and produces an internal retrospective. |

## Prompts

Prompt templates live at `prompts/trend-report.ts` and export two builders:

```ts
import {
  buildSystemPrompt,
  buildSectionPrompts,
} from '@pulsar/app-market-analysis/prompts/trend-report';
```

`buildSystemPrompt(ctx)` returns the system prompt with operator identity,
positioning, audience, hard rules, and grounding URLs interpolated from
`@pulsar/context`. `buildSectionPrompts(ctx)` returns the per-section
prompts used by passes 1 and 2 of the trend-report pipeline.

## UI routes

| Path | Source | Description |
|---|---|---|
| `/drafts` | `ui/drafts/page.tsx` | Lists generated content drafts grouped by report (current Phase 1 implementation is the existing flat list, slated for restructure in Phase 6). |
| `/reports/:id` | (planned) | Report viewer. The existing renderer in `packages/web/components/report/` is slated to move into this app in a later phase. |

The web package keeps thin re-export shims under
`packages/web/app/(dashboard)/drafts/` so URLs stay stable while the app
owns the implementation.

## Required `.context/` fields

The app reads these fields from the operator context at startup. If any are
missing, the pipelines refuse to start with a clear error pointing at
`pnpm setup`.

| Field | Purpose |
|---|---|
| `positioning` | One-sentence org/product positioning, used in the system prompt. |
| `audience` | Who the report is written for. |
| `groundingUrls` | Allowed URLs the prompts may cite verbatim as canonical operator sources. |
| `trackedEntities` | Entities, keywords, and technologies that matter for this domain (used to weight extraction and rank signals). |
| `hardRules` | Rules the report must respect (no em-dashes, "X is a runtime not a platform", etc). |
| `allowedGitHubLogins` | GitHub usernames allowed to sign in to the dashboard. Read by `packages/web/lib/auth.ts`. |

## Required `.voice/` formats

The content-drafts pipeline expects voice samples for the platforms it
writes for. Configure samples under `.voice/samples/<format>/` for each
format below:

| Format | Used for |
|---|---|
| `long-form` | Medium, Hashnode, Dev.to, personal blog |
| `linkedin` | LinkedIn posts |
| `reddit` | Reddit posts and comments |
| `discord` | Discord/Slack messages |
| `twitter` | Twitter/X threads |

Formats with no samples return an empty array from the voice loader, so the
drafter can choose to skip a platform rather than fail.

## Integration with the Pulsar core

- The Pulsar scheduler (`packages/scraper/scheduler.ts`) runs the daily
  scrape at 05:30. When the scrape completes, the scheduler triggers
  `trend-report` from this app, then chains `content-drafts` after the
  report finishes.
- The Pulsar pipeline runner (`packages/pipeline/runner.ts`) loads `.pipe`
  files from `packages/apps/market-analysis/pipelines/` and threads operator
  context (loaded once via `loadOperatorContext()`) and voice context
  (loaded per pipeline call via `loadVoiceContext()`) into every pass.
- The web package (`packages/web/`) re-exports this app's UI components
  through shim files under `app/(dashboard)/` so the dashboard URLs stay
  stable across app refactors.

## Operator note

This app is operator-agnostic. The Pulsar core loads operator-specific
positioning, audience, grounding URLs, and tracked entities from
`.context/` at runtime. As an example, the `.context/` setup that ships in
this repo's `packages/cli/sample-config.rocketride.yaml` happens to be
RocketRide's configuration (RocketRide is one operator running this app),
but nothing in the app code or prompts is RocketRide-specific.
