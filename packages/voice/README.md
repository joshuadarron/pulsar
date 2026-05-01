# @pulsar/voice

Pure-read loader for the operator's voice profile. Pipelines call
`loadVoiceContext(formats)` to receive tone rules, sentence patterns, things to
never write, and a small batch of writing samples per requested format.

## Install

This package is part of the Pulsar monorepo and is consumed via workspace
links. There is no standalone install path.

## API

```ts
import { loadVoiceContext, type VoiceFormat } from '@pulsar/voice';

const ctx = loadVoiceContext(['long-form', 'linkedin']);
ctx.profile.tone;             // string from "# Tone" section
ctx.profile.sentencePatterns; // string from "# Sentence patterns" section
ctx.profile.neverWrite;       // string from "# What never to write" section
ctx.profile.formats;          // VoiceFormat[] declared in frontmatter
ctx.samples['long-form'];     // up to 3 sample bodies, capped by total budget
```

`VoiceFormat` is one of: `long-form`, `linkedin`, `reddit`, `discord`,
`twitter`, `other`.

## Directory shape

The loader reads from `process.env.PULSAR_VOICE_DIR` (default: `.voice` under
the current working directory).

```
.voice/
  profile.md
  samples/
    long-form/
      sample-1.md
      sample-2.md
    linkedin/
    reddit/
    discord/
    twitter/
    other/
```

`profile.md` has YAML frontmatter and three required body sections:

```
---
formats:
  - long-form
  - linkedin
---

# Tone
<tone rules>

# Sentence patterns
<patterns>

# What never to write
<rules>
```

Section header matching is case-insensitive on the title text but requires the
`# ` prefix.

## Sample selection rules

- Up to 3 samples per requested format
- Samples are picked in alphabetical filename order
- Total injected size is capped at roughly 8000 tokens (32000 characters). When
  the cap is exceeded, the longest samples are dropped first.
- A requested format with no samples directory returns an empty array, not an
  error.

## Errors

`VoiceContextNotConfiguredError` is thrown when `profile.md` is missing. The
message points operators at `pnpm setup`. See
[`@pulsar/cli`](../cli/README.md) for the operator-onboarding walkthrough.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PULSAR_VOICE_DIR` | `.voice` | Directory the loader reads from. |

## Extra optional fields

The loader ignores any frontmatter keys it does not recognize, so the CLI
agent that owns `pnpm setup` can extend `profile.md` with operator-specific
metadata without breaking the loader.
