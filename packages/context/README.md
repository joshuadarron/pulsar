# @pulsar/context

Pure-read loader for the operator's context. Pipelines call
`loadOperatorContext()` to receive positioning, audience, hard rules, glossary,
tracked entities, allowed GitHub logins, and grounding URLs.

## Install

This package is part of the Pulsar monorepo and is consumed via workspace
links. There is no standalone install path.

## API

```ts
import { loadOperatorContext } from '@pulsar/context';

const ctx = loadOperatorContext();
ctx.operatorName;          // string
ctx.role;                  // string
ctx.orgName;               // string
ctx.domain;                // 'market-analysis' | 'technical-roadmap' | 'financial-analysis' | 'onboarding' | 'custom'
ctx.allowedGitHubLogins;   // string[]
ctx.groundingUrls;         // string[]
ctx.positioning;           // string from "# Positioning" section
ctx.audience;              // string from "# Audience" section
ctx.hardRules;             // string[] from .context/hard-rules.md bullets
ctx.glossary;              // Record<string, string>
ctx.trackedEntities;       // { entities, keywords, technologies }
```

## Directory shape

The loader reads from `process.env.PULSAR_CONTEXT_DIR` (default: `.context`
under the current working directory).

```
.context/
  profile.md
  hard-rules.md
  glossary.md
  tracked-entities.md
```

### profile.md

```
---
operatorName: Jane Doe
role: Founder
orgName: Acme Corp
domain: market-analysis
allowedGitHubLogins:
  - janedoe
groundingUrls:
  - https://acme.example.com
---

# Positioning
<positioning statement>

# Audience
<audience description>
```

The `domain` field falls back to `custom` if missing or unrecognized. Section
header matching is case-insensitive on the title text but requires the `# `
prefix.

### hard-rules.md

A markdown bullet list, no frontmatter required. Lines starting with `- ` or
`* ` become entries in `hardRules`.

### glossary.md

Either a bullet list of `- term: definition`, a markdown table with `Term` and
`Definition` columns, or a mix. The header row and the separator row of
markdown tables are skipped.

### tracked-entities.md

The loader reads the YAML frontmatter only:

```
---
entities: []
keywords: []
technologies: []
---
```

Anything in the body is operator-facing notes and is ignored.

## Errors

`OperatorContextNotConfiguredError` is thrown when `profile.md` is missing.
The pipeline runner refuses to start without this file. The error message
points operators at `pnpm setup`.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PULSAR_CONTEXT_DIR` | `.context` | Directory the loader reads from. |

## Extra optional fields

Unrecognized frontmatter keys are ignored, so the CLI agent that owns
`pnpm setup` can extend the files with operator-specific metadata without
breaking the loader.
