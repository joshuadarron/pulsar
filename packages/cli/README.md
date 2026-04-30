# @pulsar/cli

Setup CLI for Pulsar. Walks an operator through configuring a fresh clone and writes the operator-agnostic `.voice/` and `.context/` trees that the loaders package reads at runtime.

## Entry points

Three ways to invoke setup:

1. `pulsar init` (interactive, default in TTY)
2. `pulsar init --from-config <path>` (non-interactive, reads YAML; CI/CD path)
3. `pulsar setup` (alias for `pulsar init`; explicit fallback when the postinstall hook was skipped)

Add `--reconfigure` to wipe `.voice/` and `.context/` before re-running.

When `pnpm install` runs in a TTY, the root `postinstall` hook invokes the interactive flow automatically. Postinstall is silent when:

- `process.stdout.isTTY` is false (CI, Docker build, redirected stdout)
- `INIT_CWD !== process.cwd()` (Pulsar installed as a transitive dependency)
- `.voice/` and `.context/` already exist (already configured)

If `pnpm install --ignore-scripts` was used, run `pnpm setup` manually.

## YAML schema

Pass any YAML file matching this shape via `--from-config`:

```yaml
operator:
  name: string                      # required
  role: string                      # required
org:
  name: string                      # required
  positioning: string               # required, one sentence
audience: string                    # required
domain: market-analysis | technical-roadmap | financial-analysis | onboarding | custom
allowedGitHubLogins:
  - string                          # GitHub login slugs allowed to sign in
context:
  hardRules: [string]               # one rule per array entry, written as bullets
  glossary: [string]                # "term: definition" entries, written as bullets
  trackedEntities: [string]
  keywords: [string]
  technologies: [string]
  groundingUrls: [string]           # URLs the agent may scrape for context
voice:
  toneRules: [string]               # bullets
  sentencePatterns: [string]        # bullets
  neverWrite: [string]              # bullets
  samples:
    long-form: [string]             # each string is one full sample
    linkedin: [string]
    reddit: [string]
    discord: [string]
    twitter: [string]
    other: [string]
```

See `src/sample-config.example.yaml` for a generic example and `sample-config.rocketride.yaml` for the RocketRide-specific defaults.

## Output: written files

`writeConfig` produces this layout under the current working directory. Existing files are never overwritten; rerunning is a no-op unless `--reconfigure` is passed.

```
.context/
  profile.md           YAML frontmatter (operatorName, role, orgName, domain,
                       allowedGitHubLogins, groundingUrls) + markdown body
                       (Positioning, Audience).
  hard-rules.md        Markdown bullets, one rule per line. No frontmatter.
  glossary.md          Markdown bullets, "term: definition". No frontmatter.
  tracked-entities.md  YAML frontmatter (entities, keywords, technologies) +
                       free-form markdown body.
.voice/
  profile.md           YAML frontmatter (formats) + markdown body
                       (Tone, Sentence patterns, What never to write).
  samples/
    long-form/sample-N.md
    linkedin/sample-N.md
    reddit/sample-N.md
    discord/sample-N.md
    twitter/sample-N.md
    other/sample-N.md
```

If a section or sample list is empty, the file is written with a clear `<!-- placeholder -->` comment so loaders read a well-formed file.

### Frontmatter contract for the loaders agent

The loaders package (`@pulsar/voice`, `@pulsar/context`) reads these frontmatter keys:

| File | Key | Type |
|---|---|---|
| `.context/profile.md` | `operatorName` | string |
| `.context/profile.md` | `role` | string |
| `.context/profile.md` | `orgName` | string |
| `.context/profile.md` | `domain` | enum string |
| `.context/profile.md` | `allowedGitHubLogins` | string[] |
| `.context/profile.md` | `groundingUrls` | string[] |
| `.context/tracked-entities.md` | `entities` | string[] |
| `.context/tracked-entities.md` | `keywords` | string[] |
| `.context/tracked-entities.md` | `technologies` | string[] |
| `.voice/profile.md` | `formats` | string[] |

The body of `.context/profile.md` uses `# Positioning` and `# Audience` as section headers. The body of `.voice/profile.md` uses `# Tone`, `# Sentence patterns`, `# What never to write`.

## Scripts

| Command | Description |
|---|---|
| `pnpm typecheck` | Type-check the package |
| `pnpm build` | Compile to `dist/` (used by the `pulsar` bin) |
| `pnpm start` | Run `cli.ts` directly via tsx |

## Tests

Tests live under `__tests__/` and run via the root `pnpm test` script. They cover write-config output shape and the postinstall guard logic.
