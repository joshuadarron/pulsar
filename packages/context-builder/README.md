# @pulsar/context-builder

Single source of truth for constructing the context any app needs to feed an
LLM call. Wraps the operator profile loader (`@pulsar/context`), the voice
loader (`@pulsar/voice`), the intelligence builder (DB + Neo4j queries), and
the product context fetcher behind one API.

> Note: this package is the umbrella that the operator wants to live at
> `@pulsar/context` once PR 2 lands the rename. PR 1 lands it under
> `@pulsar/context-builder` to avoid touching every import in the same change.

## Why

Apps under `packages/apps/` were each writing inline DB queries to gather
entities, keywords, discussions, sentiment, etc. The runner alone had ~600
lines of `gatherX` functions. With the addition of the content recommendation
generator (which needs the same data the report saw), this duplicated logic
would land in two more places.

The context builder centralises:

- Operator profile (positioning, hard rules, grounding URLs) via the existing
  `@pulsar/context` loader.
- Voice profile + samples via the existing `@pulsar/voice` loader.
- Intelligence (entities with PageRank, trending keywords with deltas, top
  discussions, topic clusters, sentiment, top authors) computed on demand from
  `articles` + `graph_snapshots`. Reconstructible without persisting raw data
  in the report's JSONB.
- Product context (positioning, package metadata, scraped site content)
  generalised to use the operator's `groundingUrls` instead of hardcoded
  RocketRide URLs.

Every other package consumes through `buildContext({ slices })` and gets a
fully-formed `AppContext` back.

## API

```ts
import { buildContext, buildReportContext } from '@pulsar/context-builder';

// Live pipeline run: build everything fresh
const ctx = await buildContext({
  slices: ['operator', 'voice', 'intelligence', 'product'],
  window: { start, end },
  voiceFormats: ['long-form', 'linkedin', 'twitter']
});

// Reconstruction for an existing report (e.g., --content-only)
const ctx = await buildReportContext(reportId, {
  voiceFormats: ['long-form', 'linkedin', 'twitter']
});
// Uses report.period_start / period_end / graph_snapshot_id.
// Recomputes the snapshot only if it is stale or missing.
```

## Snapshot caching and recompute

`buildContext` resolves the graph snapshot in this order:

1. If `graphSnapshotId` is passed (or derived from `reportId`), use it directly.
2. Else find the most recent `graph_snapshots` row whose `computed_at` falls
   inside the requested window.
3. If found, check whether new articles have been ingested since
   `computed_at` for that window. If yes, the snapshot is stale.
4. On stale or missing, acquire a Postgres advisory lock keyed by the window,
   re-run gds.louvain.stream and gds.pageRank.stream filtered to articles in
   the window, persist a new `graph_snapshots` row, and return it.

Recompute is logged so the operator sees when it happens and roughly how long
it takes.

## Layout

```
src/
  index.ts           re-exports buildContext, buildReportContext, types
  types.ts           ContextSlice, BuildContextOptions, IntelligenceContext, ProductContext, AppContext
  build.ts           buildContext, buildReportContext implementations
  intelligence/
    index.ts         buildIntelligence({ window, graphSnapshotId? })
    snapshot.ts      getOrComputeSnapshot with staleness detection + advisory lock
    entities.ts      entity centrality + history
    keywords.ts      trending keywords with deltas + velocity
    discussions.ts   top discussions, top authors, sentiment
    clusters.ts      topic clusters from graph_snapshots
  product/
    index.ts         buildProduct({ operator })
    fetcher.ts       reads operator.groundingUrls and gathers package metadata + scraped content
  __tests__/
```
