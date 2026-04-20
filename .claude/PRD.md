# PRD: Pulsar — Automated DevRel Intelligence & Content Agent

## Purpose

Joshua spends too much time on the marketing and community side of DevRel. Pulsar automates the majority of that surface area: content research, trend analysis, draft generation, and reporting. The goal is to get DevRel-related time spend to under 15% of the work week, with the rest freed for building.

This system is a programmatic data pipeline that feeds a RocketRide AI layer, which does the intelligence work and outputs structured reports and content drafts for human review.

---

## Goals

- Scrape 100% free, no-paywall sources twice daily (00:00 and 12:00)
- Store raw data in PostgreSQL, relationships in Neo4j
- Run RocketRide AI pipelines once daily at 04:00
- Save structured report data to PostgreSQL, render it natively in the UI with charts and graphs
- Send a properly formatted HTML email at 04:00 with a link back to the full report in the UI
- Allow on-demand PDF export of any report from the UI
- Generate draft content for articles and social (human reviews before posting)
- Zero manual effort on data collection or report assembly

## Non-Goals (v1)

- Auto-posting to any platform
- Paid API integrations
- Multi-user support
- Mobile UI

---

## Run Schedule

| Process | Schedule | Trigger |
|---|---|---|
| Scraper (all sources) | 00:00 and 12:00 daily | node-cron |
| RocketRide AI pipelines | 04:00 daily | node-cron |
| Manual scrape | On demand | CLI / UI button |
| Manual pipeline run | On demand | CLI / UI button |

The scraper and RocketRide pipelines run on independent schedules. The 04:00 pipeline run processes everything collected during the previous day's two scrape runs.

---

## Architecture

```
+------------------------------------------------------------------+
|                         Local Machine                            |
|                                                                  |
|  Scraper Scheduler (node-cron)       RocketRide Scheduler        |
|  Triggers at 00:00 and 12:00         Triggers at 04:00           |
|            |                                   |                  |
|            v                                   v                  |
|  +---------------------+         +---------------------------+   |
|  | Scraper             |         | RocketRide Runtime        |   |
|  | (programmatic       |         | (AI Layer)                |   |
|  |  Node.js, no AI)    |         |                           |   |
|  |                     |         | Pipeline 1: summarization  |   |
|  | - API-first sources |         | Pipeline 2: trend-report   |   |
|  | - Raw scrape rest   |         | Pipeline 3: content-drafts |   |
|  | - Dedup by URL hash |         |                           |   |
|  | - Write raw to PG   |         | Saves structured JSON     |   |
|  | - Write graph to    |         | report to PostgreSQL.     |   |
|  |   Neo4j             |         | No PDF generation here.   |   |
|  +---------------------+         +---------------------------+   |
|            |                                   |                  |
|            v                                   v                  |
|  +---------------------+         +---------------------------+   |
|  |     PostgreSQL      |         | Email (nodemailer)        |   |
|  |  - articles_raw     |         | HTML email, inline styles |   |
|  |  - articles         |<------->| Link to report in UI      |   |
|  |  - reports (JSON)   |         +---------------------------+   |
|  |  - content_drafts   |                                         |
|  |  - runs             |                                         |
|  +---------------------+                                         |
|            |                                                      |
|  +---------------------+         +---------------------------+   |
|  |       Neo4j         |         |   Next.js App (UI + API)  |   |
|  |  - Topic nodes      |-------->|   - Report view           |   |
|  |  - Entity nodes     |         |     (charts, graphs,      |   |
|  |  - Article nodes    |         |      snippets, native)    |   |
|  |  - Relationships    |         |   - On-demand PDF export  |   |
|  |  - trendScores      |         |   - Content drafts        |   |
|  +---------------------+         |   - Trend dashboard       |   |
|                                  |   - Graph explorer        |   |
|                                  +---------------------------+   |
+------------------------------------------------------------------+
```

**Stack:**
- Runtime: Node.js 20+
- Framework: Next.js 15 (App Router)
- Databases: PostgreSQL 16 + Neo4j 5.x (both via Docker Compose)
- Scraping: native `fetch` for APIs, `rss-parser` for feeds
- AI Runtime: RocketRide (WebSocket, port 5565, pipelines as JSON)
- LLM: Claude via RocketRide pipeline nodes
- PDF export: Puppeteer, invoked server-side on demand via `/api/reports/:id/export/pdf`
- Charts: Recharts (React, MIT licensed)
- Scheduling: `node-cron` (two independent schedulers)
- Auth: NextAuth.js v5 (Google + GitHub)
- Styling: Tailwind CSS
- Package manager: pnpm

---

## Data Sources (100% Free, v1)

| Source | Method | Notes |
|---|---|---|
| Hacker News | Algolia Search API | Free, no key required |
| Reddit | Reddit JSON API (/r/sub.json) | Free, unauthenticated read |
| GitHub | REST Search API (/search/repositories) | Free tier, no key required |
| ArXiv | Atom feed API | Free, no key required |
| Hashnode | Public GraphQL API | Free, no key required |
| Dev.to | Public REST API | Free, no key required |
| Medium | RSS tag feeds | Free |
| Substack | RSS per publication | Free, configurable list |
| Custom RSS / Blogs | RSS/Atom parsing | Free, configurable list |

**Sources excluded in v1:**
- Twitter/X (paid API tier required)
- LinkedIn (no public scraping API)
- Discord (requires bot token)
- GitHub Trending page (HTML scrape too brittle, replaced by Search API)

**Extensibility:** Every source is a self-contained adapter in `/scraper/sources/`. Adding a new source means one new adapter file and one line in `/scraper/sources/index.ts`.

### Reddit Subreddit List (v1, open source focused)

Configurable in `config/sources.ts`:

```
r/opensource
r/programming
r/MachineLearning
r/LocalLLaMA
r/artificial
r/devops
r/rust
r/golang
r/node
r/typescript
r/webdev
r/selfhosted
```

### GitHub Search API Queries (v1)

```
/search/repositories?q=topic:ai+topic:llm&sort=stars&order=desc
/search/repositories?q=topic:open-source+pushed:>DATE&sort=stars&order=desc
/search/repositories?q=topic:developer-tools+pushed:>DATE&sort=stars&order=desc
```

All queries configurable in `config/sources.ts`.

---

## Scraper (Programmatic)

Standalone Node.js process. No AI calls. Data collection and storage only.

### Run Schedule
- 00:00 and 12:00 via `node-cron`
- Manual: `pnpm run scrape`
- Per-source: `pnpm run scrape --source=hackernews`

### Per-Source Pipeline

```
1. Call source adapter -> ScrapedItem[]
2. For each item:
   a. SHA-256 of canonical URL
   b. Check PostgreSQL (skip if hash exists)
   c. Insert raw JSON into articles_raw
   d. Lightweight extraction (no LLM):
      - Keyword candidates (TF-IDF, stopword filtered)
      - Entity candidates (regex against curated list)
      - Source category tag
   e. Write Article node to Neo4j
   f. Merge Topic and Entity nodes
   g. Write relationships: TAGGED_WITH, MENTIONS, FROM_SOURCE
3. Update trendScore on affected Topic nodes
4. Log run to PostgreSQL
```

### Source Adapter Interface

```typescript
export interface ScrapedItem {
  url: string
  title: string
  rawContent: string
  publishedAt: Date
  author?: string
  score?: number
  commentCount?: number
  sourceName: string
  sourcePlatform: string
}

export type SourceAdapter = () => Promise<ScrapedItem[]>
```

---

## RocketRide Pipelines (AI Layer)

Three pipelines triggered sequentially at 04:00 by the pipeline scheduler via WebSocket.

### Trigger Flow

```
04:00 cron fires
  -> open WS to RocketRide (port 5565)
  -> send { type: "run", pipeline: "summarization" }
  -> await completion ack
  -> send { type: "run", pipeline: "trend-report" }
  -> await completion ack (report JSON now in PostgreSQL)
  -> send { type: "run", pipeline: "content-drafts" }
  -> await completion ack
  -> send HTML email notification with link to report in UI
```

---

### Pipeline 1: `summarization`

**Input:** All articles in PostgreSQL where `enriched_at IS NULL`, from the last 24 hours.

**Per article, Claude generates:**
- `summary`: 2-3 sentence technical summary
- `contentType`: research | tutorial | news | opinion | release | discussion
- `sentiment`: positive | negative | neutral
- `topicTags`: normalized slug array
- `entityMentions`: [{ name, type }]

**Output:** Enriched fields written to `articles` table. Neo4j relationships updated.

**System prompt:**
```
You are a technical analyst specializing in AI and software engineering.
Given an article title and body, return only valid JSON with no preamble or markdown:
{
  "summary": "2-3 sentence technical summary",
  "contentType": "research|tutorial|news|opinion|release|discussion",
  "sentiment": "positive|negative|neutral",
  "topicTags": ["normalized-slug"],
  "entityMentions": [{ "name": "string", "type": "company|tool|model|language|person|concept" }]
}
```

---

### Pipeline 2: `trend-report`

**Input:** Neo4j trend queries (7d and 30d windows) + enriched articles from PostgreSQL.

**Output:** Structured JSON report saved to PostgreSQL `reports` table. No PDF generated here.

**Report data shape (stored as `report_data JSONB`):**

```json
{
  "executiveSummary": "string",
  "period": { "start": "ISO date", "end": "ISO date" },
  "articleCount": 0,
  "trendingKeywords": [
    { "keyword": "string", "count7d": 0, "count30d": 0, "delta": 0.0 }
  ],
  "trendingTopics": [
    { "topic": "string", "trendScore": 0.0, "sentiment": "string", "articleCount": 0, "sparkline": [0] }
  ],
  "trendingTechnologies": [
    { "name": "string", "type": "string", "mentionCount": 0 }
  ],
  "emergingTopics": ["string"],
  "entityProminence": [
    { "name": "string", "type": "string", "mentionCount": 0 }
  ],
  "topicCoOccurrence": [
    { "topicA": "string", "topicB": "string", "count": 0 }
  ],
  "velocityOutliers": [
    { "topic": "string", "spike": 0.0, "baseline": 0.0 }
  ],
  "contentOpportunities": [
    { "signal": "string", "source": "string", "url": "string" }
  ],
  "sourceDistribution": [
    { "source": "string", "articleCount": 0, "topTopics": ["string"] }
  ],
  "narrativeAnalysis": {
    "keywords": "string",
    "topics": "string",
    "technologies": "string",
    "opportunities": "string"
  }
}
```

Claude generates the `narrativeAnalysis` strings and `contentOpportunities`. All other fields are computed from Neo4j queries and PostgreSQL aggregations.

---

### Pipeline 3: `content-drafts`

**Input:** `report_data` from the latest report + top 10 articles from the last 24 hours.

**Article drafts:**

| Platform | Format |
|---|---|
| Hashnode | Full markdown article. Canonical source. |
| Medium | Same content + `canonical_url` pointing to Hashnode |
| Dev.to | Same content + `canonical_url` pointing to Hashnode |
| Hacker News | "Show HN" or "Ask HN" title + brief description |

**Social drafts (derived from the article draft):**

| Platform | Format |
|---|---|
| LinkedIn | Long-form post, 800-1200 words, no markdown, first person |
| X (Twitter) | Numbered thread, 280 chars per tweet, technical tone |
| Discord | Short announcement pointing to article, community tone |

All drafts stored in PostgreSQL `content_drafts` with status `draft`.

---

## Report: Email vs UI vs PDF Export

The same underlying `report_data` JSON is the source of truth for all three representations.

### UI (primary view)

The report page at `/reports/:id` renders the full report natively:
- Executive summary as styled prose
- Trending keywords as a horizontal bar chart (Recharts)
- Trending topics as a ranked list with sparklines and sentiment badges
- Technologies as a ranked bar chart
- Emerging topics highlighted with a badge
- Entity prominence as a bubble or bar chart
- Topic co-occurrence as a heatmap or network mini-graph
- Velocity outliers as a sorted table with delta indicators
- Content opportunities as a card list with links to source articles
- Source distribution as a donut or stacked bar chart
- Raw numbers in a summary stats row at the bottom

### Email (delivered at 04:00)

HTML email with inline CSS styles (email-client safe). Contains:
- Executive summary
- Top 5 trending keywords as a simple ranked list
- Top 5 trending topics with trendScore
- Top 3 content opportunities
- "View full report" button linking to `/reports/:id` in the UI
- "Download PDF" link pointing to `/api/reports/:id/export/pdf`

No charts in the email. Tables and lists only, for maximum email client compatibility.

### PDF Export (on demand)

Triggered by the "Export PDF" button in the UI or via the email download link.

- API route: `GET /api/reports/:id/export/pdf`
- Server-side Puppeteer renders the report page (`/reports/:id?print=true`) to PDF
- `?print=true` query param activates a print-optimized CSS stylesheet (no sidebars, no nav, charts scale to page width)
- PDF streamed back to the client for download
- Puppeteer runs as a one-off subprocess, not in the pipeline

---

## PostgreSQL Schema

```sql
CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',       -- running | complete | failed
  trigger TEXT DEFAULT 'scheduled',    -- scheduled | manual
  run_type TEXT DEFAULT 'scrape',      -- scrape | pipeline
  articles_scraped INT DEFAULT 0,
  articles_new INT DEFAULT 0,
  error_log TEXT
);

CREATE TABLE articles_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url_hash CHAR(64) UNIQUE NOT NULL,
  url TEXT NOT NULL,
  raw_payload JSONB NOT NULL,
  source_name TEXT NOT NULL,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  run_id UUID REFERENCES runs(id)
);

CREATE TABLE articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_id UUID REFERENCES articles_raw(id),
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content_type TEXT,
  sentiment TEXT,
  topic_tags TEXT[],
  entity_mentions JSONB,
  published_at TIMESTAMPTZ,
  source_name TEXT,
  source_platform TEXT,
  score INT,
  comment_count INT,
  enriched_at TIMESTAMPTZ,
  run_id UUID REFERENCES runs(id)
);

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES runs(id),
  generated_at TIMESTAMPTZ DEFAULT now(),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  report_data JSONB NOT NULL,          -- full structured report, UI renders from this
  article_count INT
);

CREATE TABLE content_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES runs(id),
  report_id UUID REFERENCES reports(id),
  platform TEXT NOT NULL,              -- hashnode | medium | devto | hn | linkedin | x | discord
  content_type TEXT NOT NULL,          -- article | social
  body TEXT NOT NULL,
  status TEXT DEFAULT 'draft',         -- draft | approved | exported
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Neo4j Graph Model

### Nodes

**Article** — `id, url, title, publishedAt, scrapedAt, contentType, sentiment, score, sourcePlatform`

**Topic** — `id, name, category, trendScore, firstSeen, lastSeen`

**Entity** — `id, name, type`

**Author** — `id, handle, platform, profileUrl`

**Source** — `id, name, platform, type`

### Relationships

```
(Article)-[:FROM_SOURCE]->(Source)
(Article)-[:AUTHORED_BY]->(Author)
(Article)-[:TAGGED_WITH]->(Topic)
(Article)-[:MENTIONS]->(Entity)
(Article)-[:CO_OCCURS_WITH { count: int }]->(Topic)
(Topic)-[:RELATED_TO { weight: float }]->(Topic)
(Entity)-[:ASSOCIATED_WITH]->(Topic)
```

### trendScore Formula

```
trendScore = sum(article.score * e^(-lambda * days_since_published))
```

`lambda` defaults to `0.1`, configurable in `config/sources.ts`.

---

## API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/feed` | Paginated article feed with filters |
| GET | `/api/topics/trending` | Top topics by trendScore |
| GET | `/api/reports` | List all reports |
| GET | `/api/reports/:id` | Single report data (JSON) |
| GET | `/api/reports/:id/export/pdf` | On-demand Puppeteer PDF export |
| GET | `/api/drafts` | List drafts, filterable by platform/run |
| PATCH | `/api/drafts/:id` | Update draft body or status |
| GET | `/api/graph` | Graph traversal from a starting node |
| GET | `/api/runs` | Run history |
| POST | `/api/runs/trigger` | Manual scrape or pipeline trigger |

---

## File Structure

```
/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── page.tsx                   # Dashboard
│   │   ├── reports/
│   │   │   ├── page.tsx               # Report list
│   │   │   └── [id]/page.tsx          # Report detail (charts, graphs, native render)
│   │   ├── drafts/page.tsx
│   │   ├── feed/page.tsx
│   │   ├── explore/page.tsx
│   │   └── settings/page.tsx
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── reports/[id]/
│       │   ├── route.ts
│       │   └── export/pdf/route.ts    # Puppeteer on-demand PDF
│       ├── drafts/route.ts
│       ├── drafts/[id]/route.ts
│       ├── feed/route.ts
│       ├── topics/trending/route.ts
│       ├── graph/route.ts
│       └── runs/
│           ├── route.ts
│           └── trigger/route.ts
├── components/
│   ├── report/
│   │   ├── ReportView.tsx             # Full report renderer
│   │   ├── KeywordsChart.tsx          # Recharts bar chart
│   │   ├── TopicsSparkline.tsx        # Recharts sparkline per topic
│   │   ├── TechRankingChart.tsx
│   │   ├── EntityBubbleChart.tsx
│   │   ├── CoOccurrenceHeatmap.tsx
│   │   ├── VelocityTable.tsx
│   │   ├── OpportunityCards.tsx
│   │   └── SourceDonut.tsx
│   ├── drafts/
│   ├── feed/
│   └── explore/
├── scraper/
│   ├── index.ts
│   ├── scheduler.ts                   # node-cron 00:00 + 12:00
│   ├── dedup.ts
│   ├── graph-writer.ts
│   ├── trend-scorer.ts
│   └── sources/
│       ├── index.ts
│       ├── types.ts
│       ├── hackernews.ts
│       ├── reddit.ts
│       ├── github.ts
│       ├── arxiv.ts
│       ├── hashnode.ts
│       ├── devto.ts
│       ├── medium.ts
│       └── rss.ts
├── pipelines/
│   ├── summarization.json
│   ├── trend-report.json
│   └── content-drafts.json
├── pipeline-scheduler/
│   ├── index.ts
│   ├── scheduler.ts                   # node-cron 04:00
│   ├── runner.ts                      # WS client, sequential pipeline execution
│   └── notify.ts                      # HTML email with link to UI
├── lib/
│   ├── db/
│   │   ├── postgres.ts
│   │   └── neo4j.ts
│   └── rocketride.ts
├── config/
│   ├── env.ts
│   └── sources.ts
├── types/index.ts
├── docker-compose.yml
├── .env.local
└── package.json
```

---

## Environment Variables

All read exclusively from `config/env.ts`.

```bash
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=pulsar
POSTGRES_USER=pulsar
POSTGRES_PASSWORD=

# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=

# RocketRide
ROCKETRIDE_WS_URL=ws://localhost:5565

# NextAuth
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000

# OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
NOTIFY_EMAIL_TO=

# Scraper
SCRAPER_CRON_1="0 0 * * *"
SCRAPER_CRON_2="0 12 * * *"
SCRAPER_MAX_ITEMS_PER_SOURCE=100

# Pipeline scheduler
PIPELINE_CRON="0 4 * * *"

# Trend scoring
TREND_SCORE_LAMBDA=0.1
```

---

## Local Setup

```bash
# 1. Start PostgreSQL + Neo4j
docker-compose up -d

# 2. Install deps
pnpm install

# 3. Copy and fill env
cp .env.example .env.local

# 4. Run DB migrations
pnpm run db:migrate

# 5. Start RocketRide runtime (port 5565)

# 6. Run initial scrape
pnpm run scrape

# 7. Start pipeline scheduler
pnpm run pipeline-scheduler

# 8. Start Next.js
pnpm dev
```

---

## Phased Delivery

### Phase 1: Data Collection
- Docker Compose: PostgreSQL + Neo4j
- All source adapters (HN, Reddit, GitHub, ArXiv, Hashnode, Dev.to, Medium, RSS)
- Scraper scheduler at 00:00 and 12:00
- Raw data to PostgreSQL, graph to Neo4j, trendScore computing

### Phase 2: RocketRide AI Layer
- Pipeline scheduler at 04:00
- `summarization` pipeline end to end
- `trend-report` pipeline saving structured JSON to PostgreSQL
- `content-drafts` pipeline for all seven platforms
- HTML email notification with link to UI report

### Phase 3: Core UI
- Auth (Google + GitHub)
- Report list + report detail view with all charts rendered from `report_data`
- Print stylesheet (`?print=true`) for clean PDF rendering
- On-demand PDF export via Puppeteer (`/api/reports/:id/export/pdf`)
- Content Drafts view

### Phase 4: Feed + Graph Explorer
- Enriched article feed with filters
- `react-force-graph` graph explorer

### Phase 5: Polish
- Settings view with source management
- Manual trigger in UI
- Error handling and retry logic
- Run history log view
