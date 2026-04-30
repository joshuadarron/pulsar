# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### [2026-04-30] Phase 1: Apps framework

#### Added

- `packages/apps/` directory housing self-contained domain workflows
- `@pulsar/app-market-analysis` workspace package containing the existing market-analysis pipelines, prompts, and UI
- `app.config.ts` per-app configuration declaring schedule defaults, expected context fields, and render mode
- `packages/apps/README.md` documenting the app contract and future-app scaffolds (technical-roadmap, financial-analysis, onboarding)

#### Changed

- `.pipe` files now live under `packages/apps/market-analysis/pipelines/` and are tracked in git (Postgres password templated to `${POSTGRES_PASSWORD}`)
- `packages/pipeline/runner.ts` imports prompts and pipelines directory from `@pulsar/app-market-analysis`
- `packages/web/app/(dashboard)/drafts/page.tsx` is now a thin re-export shim; the implementation lives in `@pulsar/app-market-analysis/ui/drafts`
- `pnpm-workspace.yaml` includes `packages/apps/*`

### Phase 0 (2026-04-30)

#### Added

- Operator-agnostic configuration via `.voice/` and `.context/` directories. Both are gitignored, generated at setup, and read at runtime by future loaders.
- `@pulsar/cli` package with `pulsar init`, `pulsar init --from-config <path>`, and `pulsar setup` entry points. Interactive flow uses `@inquirer/prompts`; non-interactive flow reads YAML.
- Postinstall hook for interactive setup on fresh clone. Skips cleanly in non-TTY environments, when installed as a transitive dependency, and when configuration already exists.
- `packages/cli/sample-config.rocketride.yaml` reflecting the prior hardcoded RocketRide values from `packages/pipeline/trend-report-prompts.ts`. Operators can rebuild their original setup with `pulsar init --from-config packages/cli/sample-config.rocketride.yaml`.

#### Changed

- `packages/pipeline/trend-report-prompts.ts` now exports `buildSystemPrompt(ctx)` and `buildSectionPrompts(ctx)`. The previous hardcoded `SYSTEM_PROMPT` and `SECTION_PROMPTS` constants were removed; identity, positioning, audience, hard rules, and grounding URLs are interpolated from `@pulsar/context` at runtime.
- `packages/pipeline/runner.ts` loads `loadOperatorContext()` once per run and threads it through every pass. Pipelines refuse to start with a clear error message when `.context/` is not configured.
- `packages/web/lib/auth.ts` reads the GitHub allowlist from `loadOperatorContext().allowedGitHubLogins` instead of a hardcoded array. When operator context is missing, the allowlist falls back to empty (no logins permitted) and a warning is logged.
