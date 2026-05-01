# Backfill Subsystem

Historical-data ingestion for Pulsar. Backfill walks archived sources to fill gaps in `articles_raw` back to 2022-12-01 (ChatGPT release) without blocking the live daily scrape.

This subsystem is feature-flagged. Set `ENABLE_BACKFILL=true` to allow the scheduler to enqueue backfill jobs. Default is `false`.

## Layout

```
packages/scraper/backfill/
  wayback/                 Wayback CDX client + archived-HTML fetcher (this PR)
  strategies/              Per-source backfill strategies              (wave 2)
  queue.ts                 backfill_runs queue + worker dispatch        (wave 2)
  worker.ts                Standalone worker process entry point        (wave 2)
```

## Wayback module (this phase)

`packages/scraper/backfill/wayback/` is the shared infrastructure every Wayback-backed strategy uses.

Public API (`packages/scraper/backfill/wayback/index.ts`):

- `queryCdx(urlPattern, windowStart, windowEnd, options?)`: query the CDX index for snapshots of a URL pattern in a date window. Cached for 30 days.
- `fetchArchivedHtml(entry, options?)`: fetch the archived HTML body for a single CDX entry via the `id_` playback flag (no Wayback toolbar). Cached for 30 days.
- `streamArchivedHtml(urlPattern, windowStart, windowEnd, options?)`: async generator that yields `{ entry, html }` for each archived snapshot in the window, rate-limited.
- `WaybackRateLimitError`, `WaybackHttpError`: typed error classes the caller can catch to back off or retry.

### Operating notes

- **Rate limit**: 1 request per 2 seconds against `web.archive.org`. The limiter is in-process (a single shared timestamp), so all calls within one Node process honor it. Backfill workers should run with low concurrency (default 2 workers in wave 2) to avoid stacking parallel processes that would each rate-limit independently.
- **Cache location**: `.cache/wayback/` relative to `process.cwd()`. Override with the `cacheDir` option.
  - CDX responses: `.cache/wayback/cdx/<sha256-of-query-url>.json`
  - Archived HTML: `.cache/wayback/html/<timestamp>-<sha256-of-original-url>.html`
- **Cache TTL**: 30 days. Past that, the next read returns null and triggers a fresh fetch.
- **Bypass cache**: set `WAYBACK_CACHE_DISABLE=true` (useful for tests and verification).
- **Clear cache**: `rm -rf .cache/wayback`.
- **Retries**: HTTP 5xx is retried up to 3 times with exponential backoff. HTTP 429 is surfaced as `WaybackRateLimitError` for the caller to handle (do not blindly retry, back off the worker queue instead). HTTP 404 and Wayback's robots-block response return `null` so the strategy can skip that snapshot.
- **User-Agent**: `Pulsar-Backfill/0.1 (+https://github.com/joshuadarron/pulsar)`. Override with the `userAgent` option.

### First-deploy expectations

Initial backfill of all Wayback-backed sources from 2022-12-01 is heavy. At 1 req/2s, a single source with ~5000 unique snapshots takes roughly 3 hours of network time, plus parse and ingest. The full first run across all configured sources is expected to take several days to a couple of weeks. The work is interruptible: any rerun resumes from the cache and skips ingestion of already-stored URLs (via the dedup hash).

### Smoke test

Run from the repo root:

```bash
WAYBACK_CACHE_DISABLE=false node --import tsx -e "
import { queryCdx } from './packages/scraper/backfill/wayback/index.ts';
const entries = await queryCdx(
  'medium.com/towards-data-science',
  new Date('2024-01-01T00:00:00Z'),
  new Date('2024-01-07T00:00:00Z')
);
console.log('CDX entries returned:', entries.length);
console.log('First entry:', entries[0]);
"
ls -la .cache/wayback/cdx/
```

A cache file under `.cache/wayback/cdx/` confirms end-to-end CDX flow.

## Strategy framework (wave 2)

Per-source backfill strategies live under `packages/scraper/backfill/strategies/`, one file per source family. Each strategy implements a common shape: given a window, produce `ScrapedItem[]` from whichever archive it knows how to walk (Wayback CDX, sitemap walk, direct API). Wave 2 fills in this section with the actual contract and the per-source files (arXiv, news sites, Reddit, Medium publications, Dev.to, generic RSS, Hugging Face, GitHub, OpenAI, Common Crawl).

## Queue

`backfill_runs` and `backfill_jobs` are the queue tables. `enqueueBackfill` (in `queue.ts`) inserts both rows. Workers atomically claim jobs via `FOR UPDATE SKIP LOCKED` so multiple workers never receive overlapping IDs. `completeJob` and `failJob` reconcile both the job row and the parent run row.

Backfill jobs run with their own Postgres advisory lock (id 73953) so they never block the live scrape lock (id 73952). The two locks are independent: the live scheduler can run while backfill is paused, and vice versa.

## Worker

`pnpm run backfill-worker` starts the worker process. It acquires advisory lock 73953 (only one worker process per box), then loops:

1. Claim up to `BACKFILL_WORKER_CONCURRENCY` jobs (default 2) via `claimJobs`.
2. For each claimed job, dispatch to `getStrategy(sourceName)`, run the strategy, insert returned items via `insertBackfilledItems`, and mark the job complete.
3. On strategy or insert error, mark the job failed and continue. Errors never crash the worker.
4. When the queue is empty, sleep 5 seconds and poll again.
5. On `SIGINT` or `SIGTERM`, abort in-flight work, release the advisory lock, and exit.

Worker logs are JSON to stdout / stderr, one event per line. Component tag: `backfill-worker`.

## CLI: manual enqueue

For ad-hoc backfills (testing a single source, replaying a known gap):

```bash
pnpm run backfill -- --source=arxiv --from=2024-01-01 --to=2024-01-07
```

The CLI inserts a `backfill_runs` + `backfill_jobs` row and exits. The worker (started separately) picks the job up on its next poll. Valid sources match the registered strategies (`arxiv`, `devto`, `github`, `hackernews`, `hashnode`, `medium`, `reddit`, `rss`).

## Auto-enqueue and gap detection

The scheduler (`packages/scraper/scheduler.ts`) runs on every scrape tick when `ENABLE_BACKFILL=true`:

- **Auto-enqueue** (`maybeAutoEnqueue`): for each source whose `articles_raw` row count is below `FIRST_DEPLOY_THRESHOLD` (30) AND has no existing `backfill_runs` covering 2022-12-01, enqueue a full backfill from 2022-12-01 to now.
- **Gap detection** (`detectGaps`): for each source, if the most recent live ingest is older than the per-source threshold (1 to 14 days), enqueue a gap-fill backfill from the last ingest forward.

Both are idempotent. Re-running the same scheduler tick does not produce duplicate runs.
