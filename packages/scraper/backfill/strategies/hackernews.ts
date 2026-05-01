import type { ScrapedItem } from '@pulsar/shared/types';

import type { Strategy, StrategyContext, StrategyResult } from './types.js';

const HN_SEARCH_ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date';
const HN_HITS_PER_PAGE = 100;
const HN_MAX_PAGES = 50;
const HN_RATE_LIMIT_MS = 1000;

let lastHnRequestAt = 0;

/** Reset the in-process rate limiter. Test-only. */
export function __resetHackernewsRateLimiterForTesting(): void {
	lastHnRequestAt = 0;
}

async function sleep(ms: number): Promise<void> {
	if (ms <= 0) return;
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyHnRateLimit(): Promise<void> {
	const now = Date.now();
	const elapsed = now - lastHnRequestAt;
	const wait = HN_RATE_LIMIT_MS - elapsed;
	if (wait > 0) await sleep(wait);
	lastHnRequestAt = Date.now();
}

type AlgoliaHit = {
	objectID: string;
	title?: string;
	url?: string;
	author?: string;
	points?: number;
	num_comments?: number;
	created_at?: string;
	created_at_i?: number;
	story_text?: string;
};

type AlgoliaResponse = {
	hits: AlgoliaHit[];
	page: number;
	nbPages: number;
};

function buildHnUrl(windowStart: Date, windowEnd: Date, page: number): string {
	const startSec = Math.floor(windowStart.getTime() / 1000);
	const endSec = Math.floor(windowEnd.getTime() / 1000);
	const params = new URLSearchParams({
		tags: 'front_page',
		numericFilters: `created_at_i>=${startSec},created_at_i<${endSec}`,
		hitsPerPage: String(HN_HITS_PER_PAGE),
		page: String(page)
	});
	return `${HN_SEARCH_ENDPOINT}?${params.toString()}`;
}

function isWithinWindow(date: Date, windowStart: Date, windowEnd: Date): boolean {
	const t = date.getTime();
	return t >= windowStart.getTime() && t <= windowEnd.getTime();
}

/**
 * Hacker News backfill strategy. Uses the Algolia HN search API which supports
 * arbitrary historical date ranges via numericFilters on `created_at_i`.
 *
 * Pagination terminates either when the API reports `nbPages` exhausted or
 * when a page returns fewer than HN_HITS_PER_PAGE results.
 */
export const hackernewsStrategy: Strategy = async (
	ctx: StrategyContext
): Promise<StrategyResult> => {
	const items: ScrapedItem[] = [];
	const errors: string[] = [];

	for (let page = 0; page < HN_MAX_PAGES; page++) {
		if (ctx.signal?.aborted) break;

		const url = buildHnUrl(ctx.windowStart, ctx.windowEnd, page);
		let data: AlgoliaResponse;
		try {
			await applyHnRateLimit();
			const response = await fetch(url);
			if (!response.ok) {
				errors.push(`hackernews page ${page} HTTP ${response.status}`);
				break;
			}
			data = (await response.json()) as AlgoliaResponse;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`hackernews page ${page} fetch failed: ${message}`);
			break;
		}

		const hits = Array.isArray(data.hits) ? data.hits : [];
		if (hits.length === 0) break;

		for (const hit of hits) {
			if (!hit.url) {
				continue;
			}
			const createdAt = hit.created_at_i
				? new Date(hit.created_at_i * 1000)
				: hit.created_at
					? new Date(hit.created_at)
					: null;
			if (!createdAt || Number.isNaN(createdAt.getTime())) {
				errors.push(`hackernews hit missing publishedAt: ${hit.objectID}`);
				continue;
			}
			if (!isWithinWindow(createdAt, ctx.windowStart, ctx.windowEnd)) continue;
			if (!hit.title) {
				errors.push(`hackernews hit missing title: ${hit.objectID}`);
				continue;
			}
			items.push({
				url: hit.url,
				title: hit.title,
				rawContent: hit.story_text || hit.title,
				publishedAt: createdAt,
				author: hit.author,
				score: hit.points,
				commentCount: hit.num_comments,
				sourceName: 'Hacker News',
				sourcePlatform: 'hackernews',
				sourceOrigin: 'direct_archive',
				backfillRunId: ctx.backfillRunId
			});
		}

		if (typeof data.nbPages === 'number' && page + 1 >= data.nbPages) break;
		if (hits.length < HN_HITS_PER_PAGE) break;
	}

	return { items, errors };
};
