# @pulsar/app-market-analysis

The market-analysis app tracks developer-market trends across free public sources (Hacker News, Reddit, GitHub, arXiv, Hashnode, Dev.to, Medium, RSS), runs AI analysis over the resulting graph, generates a weekly trend report, and produces content drafts ready for human review. It is the first app shipped on Pulsar and the reference implementation of the apps contract defined in [`packages/apps/README.md`](../README.md).

## Pipelines

| Pipeline | When it runs | What it does |
|---|---|---|
| `trend-report` | Daily at 05:30 (after the scheduled scrape completes) | Four-pass report generation. Pass 1 writes Market Snapshot and Developer Signals. Pass 2 produces Signal Interpretation (3 to 7 interpretations, each with `signal`, `meaning`, `implication`). Pass 3 writes the executive summary. Pass 4 aggregates and ranks Supporting Resources from per-section research entries. |
| `angle-picker` (content drafts, pass 1) | Chained after `trend-report` | Reads the completed report's signal interpretations, picks one or more angles, and for each angle picks the platforms that fit. |
| `content-drafter` (content drafts, pass 2) | Chained after `angle-picker` | Writes the drafts using the operator's voice samples for only the platforms the picker chose. |
| `evaluation` | On demand or after each report | Scores the report against a checklist (hard rules respected, claims grounded in `research[]`, no banned phrasing). |
| `retrospective` | Weekly | Aggregates report and content metrics over the prior period and produces an internal retrospective. |

## Prompts

Prompt templates live under `prompts/`:

```ts
import {
  buildSystemPrompt,
  buildSectionPrompts,
} from '@pulsar/app-market-analysis/prompts/trend-report';

import {
  buildAnglePickerSystemPrompt,
  buildAnglePickerUserPrompt,
  buildDrafterSystemPrompt,
  buildDrafterUserPrompt,
} from '@pulsar/app-market-analysis/prompts/content-drafts';
```

Operator identity, positioning, audience, hard rules, voice profile, voice samples, and grounding URLs are interpolated at runtime via the loader packages. The `.pipe` files carry no operator hardcoding.

## UI routes

| Path | Source | Description |
|---|---|---|
| `/drafts` | `ui/drafts/page.tsx` | Report-grouped list. Each card shows the report date, the top opportunity, and the count of drafts and platforms. |
| `/drafts/<reportId>` | `ui/drafts/[reportId]/page.tsx` | Per-report viewer. Drafts grouped by `angle`, with platform tabs and four content tabs per platform (generated content, steps to post, voice transfer prompt, topic refinement prompt). |

The web package keeps thin re-export shims under `packages/web/app/(dashboard)/drafts/` so URLs stay stable while the app owns the implementation.

## Templates

`templates/` holds the per-platform post-step templates and the two scoping prompts (voice transfer, topic refinement). Pure fill helpers are exported as `@pulsar/app-market-analysis/templates`:

- `fillPostSteps(platform, vars)`
- `fillVoiceTransferPrompt(vars)`
- `fillTopicRefinementPrompt(vars)`
- `POST_STEP_PLATFORM_LIST`

The fill helpers are pure functions. Templates are read once at module init via `readFileSync`.

## Required `.context/` fields

The app reads these fields at startup. If any are missing, the pipelines refuse to start with a clear error pointing at `pnpm setup`. See [`@pulsar/context`](../../context/README.md) for the file shapes.

| Field | Purpose |
|---|---|
| `positioning` | One-sentence org/product positioning, used in the system prompt. |
| `audience` | Who the report is written for. |
| `groundingUrls` | URLs the prompts may cite verbatim as canonical operator sources. |
| `trackedEntities` | Entities, keywords, and technologies that matter for this domain (used to weight extraction and rank signals). |
| `hardRules` | Rules the report must respect (no em-dashes, "X is a runtime not a platform", and so on). |
| `allowedGitHubLogins` | GitHub usernames allowed to sign in to the dashboard. Read by `packages/web/lib/auth.ts`. |

## Required `.voice/` formats

The content-drafts pipeline expects voice samples for the platforms it writes for. Configure samples under `.voice/samples/<format>/`. See [`@pulsar/voice`](../../voice/README.md) for the file shapes and selection rules.

| Format | Used for |
|---|---|
| `long-form` | Medium, Hashnode, Dev.to, personal blog |
| `linkedin` | LinkedIn posts |
| `reddit` | Reddit posts and comments |
| `discord` | Discord and Slack messages |
| `twitter` | Twitter/X threads |

Formats with no samples return an empty array from the voice loader, so the drafter (or the angle picker upstream) can choose to skip a platform rather than fail.

## Integration with the Pulsar core

- The Pulsar scheduler (`packages/scraper/scheduler.ts`) runs the daily scrape at 05:30. When the scrape completes, the scheduler triggers `trend-report` from this app, then chains the content drafts pipelines after the report finishes.
- The Pulsar pipeline runner (`packages/pipeline/runner.ts`) loads `.pipe` files from `pipelines/` and threads operator context (loaded once per run) and voice context (loaded per pipeline call) into every pass.
- The web package re-exports this app's UI components through shim files under `packages/web/app/(dashboard)/` so the dashboard URLs stay stable across app refactors.

## Operator note

This app is operator-agnostic. The Pulsar core loads operator-specific positioning, audience, grounding URLs, and tracked entities from `.context/` at runtime. The example config that ships at `packages/cli/sample-config.rocketride.yaml` happens to be one operator's setup (RocketRide), but nothing in the app code or prompts is RocketRide-specific.
