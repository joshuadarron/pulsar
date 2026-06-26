# Pulsar Apps

Pulsar is a configurable agent framework. Domain-specific workflows live as
self-contained apps under this directory. Each app owns its pipelines,
prompts, output schema, and UI surface, and runs on top of the shared Pulsar
core (scheduler, scraper, analysis, content drafter).

## The contract

> An app is a self-contained domain workflow built on Pulsar. It owns its
> pipelines, prompts, output schemas, and **headless surface** (typed
> view-models plus read endpoints). It declares what it expects from
> `.context/` and `.voice/`. It does not reach across to other apps and it
> ships no React. The shell (Pulsar's reference web app, the RocketRide
> shell, or any future host) consumes the headless surface and renders
> view-models with its own primitives.

## What an app exports

An app exports the following surface:

- **Pipelines and their schedules.** A list of pipeline definitions (the
  `.pipe` files the runner sends to the operator's pipeline engine) along
  with default schedule expressions.
- **View-models.** Pure-TS builders under `views/` that take raw data and
  return a typed `ViewModel` (a tree of shell-renderable blocks from
  `@pulsar/view-model`). Each view declares an `id`, `title`, and optional
  `route` in `app.config.ts#views`. The shell maps the id to the builder
  and renders the result.
- **Read endpoints.** Pure-TS functions under `api/` that the shell calls
  in-process or over HTTP (`/api/v1/views/<viewId>`). Each endpoint
  declares an `id` and optional `path` in `app.config.ts#endpoints`.
- **A config schema.** A declaration of which `.context/` fields the app
  expects to find (for example, `positioning`, `audience`, `groundingUrls`,
  `trackedEntities`, `allowedGitHubLogins`). The app fails fast at startup
  if a required field is missing.
- **Output templates.** String-based templates for non-block outputs the
  app produces (markdown post bodies, email subject lines, prompt
  scaffolds). The app does not render React; the shell does.

## Directory layout

Each app lives under `packages/apps/<app-name>/` with this skeleton:

```
packages/apps/<app-name>/
  pipelines/         .pipe files (templated, tracked in git)
  prompts/           system prompts and section prompts (templates)
  schemas/           output JSON schemas
  templates/         markdown / email / prompt fill templates
  views/             pure-TS view-model builders (no React)
  api/               read endpoints the shell calls
  app.config.ts      identity, schedule defaults, declared views and endpoints
  package.json
  README.md
```

`app.config.ts` is the single place an app declares its identity, schedule
defaults, expected `.context/` fields, and the headless surface (`views`
and `endpoints`). The Pulsar core reads this file to decide when to run
the app's pipelines and which views the shell should expose. The legacy
`renderMode` field is still present for backward compatibility but the
shell now decides rendering on its own.

## Adding a new app

1. Copy the skeleton from an existing app under `packages/apps/`.
2. Rename the package in `package.json` to `@pulsar/app-<name>`.
3. Update `app.config.ts` with the new app's name, description, schedule
   defaults, expected context fields, declared `views`, and declared
   `endpoints`.
4. Replace the prompts and pipelines with the new domain workflow.
5. Add view builders under `views/` that return `@pulsar/view-model`
   `ViewModel` trees. Export each builder via `package.json#exports`.
6. Wire each declared view into the shell. For the Pulsar reference web
   package, that means adding a thin loader under
   `packages/web/app/(dashboard)/` that calls the builder and passes the
   result to the generic `Renderer`. For the RocketRide shell, the
   `/api/v1/views/<viewId>` endpoint surfaces the same view-model JSON.
7. Add the workspace entry. `packages/apps/*` is already covered by
   `pnpm-workspace.yaml`, so a fresh `pnpm install` picks it up.
8. Add a `README.md` documenting the app's pipelines, expected context
   fields, expected voice formats, declared views, and integration points
   with the Pulsar core.

## Operator config and voice loaders

Apps consume operator-specific knowledge through two pure-read loader packages,
not by reading `.context/` or `.voice/` directly:

- [`@pulsar/context`](../context/README.md): positioning, audience, hard rules,
  glossary, tracked entities, allowed GitHub logins, grounding URLs.
- [`@pulsar/voice`](../voice/README.md): tone, sentence patterns, what never to
  write, plus writing samples per format.

The override env vars (`PULSAR_CONTEXT_DIR`, `PULSAR_VOICE_DIR`) and the file
shapes are documented in those package READMEs.

## Existing apps

- [`market-analysis/`](./market-analysis/README.md): tracks developer-market
  trends across free public sources, generates a weekly trend report, and
  produces content drafts ready for human review.

## Future apps

The following apps are scaffolds, not implemented. They exist to validate
that the contract is general enough to support more than one domain.

- **`technical-roadmap`**: tracks engineering trends, identifies tech debt
  patterns, and surfaces architecture decisions worth revisiting. Inputs
  come from internal repositories, RFCs, and incident postmortems alongside
  the public developer feeds Pulsar already scrapes. Output is a roadmap
  brief that highlights areas where the team is paying compounding interest
  and where current architecture choices are diverging from where the
  industry is moving.
- **`financial-analysis`**: tracks financial signals (earnings cadence,
  hiring patterns, infrastructure spend, product line shifts) for a
  configured set of companies and generates internal financial briefs.
  Inputs are public filings, press releases, and curated feeds. Output is
  a periodic brief with the deltas worth noting and the implied second-order
  effects on the operator's positioning.
- **`onboarding`**: generates personalized onboarding briefs from new-hire
  context. Inputs are the new hire's role, team, prior experience, and the
  org's internal `.context/` fields. Output is a structured first-30-days
  brief covering systems to learn, people to meet, and projects to read.
  This app exercises the contract with no scraping at all, only operator
  context plus per-instance input.

These descriptions are scaffolds, not implementation plans. They are listed
here so the contract above stays honest: if a future app cannot fit inside
the contract, the contract changes, not the app.
