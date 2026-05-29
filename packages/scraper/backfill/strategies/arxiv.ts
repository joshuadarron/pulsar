import { arxivCategories } from '@pulsar/shared/config/sources';
import type { ScrapedItem } from '@pulsar/shared/types';

import type { Strategy, StrategyContext, StrategyResult } from './types.js';

const ARXIV_QUERY_ENDPOINT = 'https://export.arxiv.org/api/query';
const ARXIV_RATE_LIMIT_MS = 3000;
const ARXIV_PAGE_SIZE = 100;
const ARXIV_MAX_PAGES_PER_CATEGORY = 50;
const ARXIV_RETRY_MAX_ATTEMPTS = 4;
const ARXIV_RETRY_BASE_DELAY_MS = 2000;

let lastArxivRequestAt = 0;

/** Reset the in-process rate limiter. Test-only. */
export function __resetArxivRateLimiterForTesting(): void {
	lastArxivRequestAt = 0;
}

async function sleep(ms: number): Promise<void> {
	if (ms <= 0) return;
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyArxivRateLimit(): Promise<void> {
	const now = Date.now();
	const elapsed = now - lastArxivRequestAt;
	const wait = ARXIV_RATE_LIMIT_MS - elapsed;
	if (wait > 0) await sleep(wait);
	lastArxivRequestAt = Date.now();
}

/**
 * Fetch with bounded exponential backoff on HTTP 429. The arXiv API returns
 * 429 even when we honor robots.txt (their bursts share quota across clients),
 * so a single 429 must not kill the entire category. Backoff sequence at
 * baseDelay=2000ms: 2s, 4s, 8s, 16s. Non-429 responses are returned as-is.
 */
async function fetchArxivWithBackoff(url: string): Promise<Response> {
	let last: Response | null = null;
	for (let attempt = 1; attempt <= ARXIV_RETRY_MAX_ATTEMPTS; attempt++) {
		await applyArxivRateLimit();
		last = await fetch(url);
		if (last.status !== 429) return last;
		if (attempt === ARXIV_RETRY_MAX_ATTEMPTS) return last;
		await sleep(ARXIV_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
	}
	return last as Response;
}

function formatArxivDate(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const year = date.getUTCFullYear();
	const month = pad(date.getUTCMonth() + 1);
	const day = pad(date.getUTCDate());
	const hour = pad(date.getUTCHours());
	const minute = pad(date.getUTCMinutes());
	return `${year}${month}${day}${hour}${minute}`;
}

function buildArxivUrl(category: string, windowStart: Date, windowEnd: Date, page: number): string {
	const start = page * ARXIV_PAGE_SIZE;
	const params = new URLSearchParams({
		search_query: `cat:${category} AND submittedDate:[${formatArxivDate(windowStart)} TO ${formatArxivDate(windowEnd)}]`,
		start: String(start),
		max_results: String(ARXIV_PAGE_SIZE),
		sortBy: 'submittedDate',
		sortOrder: 'descending'
	});
	return `${ARXIV_QUERY_ENDPOINT}?${params.toString()}`;
}

type ArxivEntry = {
	link: string;
	title: string;
	summary: string;
	publishedAt: Date | null;
	authorName: string;
};

function parseArxivFeed(xml: string): ArxivEntry[] {
	const entries: ArxivEntry[] = [];
	const chunks = xml.split('<entry>').slice(1);
	for (const chunk of chunks) {
		const getTag = (tag: string): string => {
			const match = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
			return match ? match[1].trim() : '';
		};
		const link = chunk.match(/href="(https:\/\/arxiv\.org\/abs\/[^"]+)"/)?.[1] || '';
		const title = getTag('title').replace(/\s+/g, ' ');
		const summary = getTag('summary').replace(/\s+/g, ' ');
		const publishedRaw = getTag('published');
		const authorName = getTag('name');
		const published = publishedRaw ? new Date(publishedRaw) : null;
		entries.push({ link, title, summary, publishedAt: published, authorName });
	}
	return entries;
}

function isWithinWindow(date: Date, windowStart: Date, windowEnd: Date): boolean {
	const t = date.getTime();
	return t >= windowStart.getTime() && t <= windowEnd.getTime();
}

/**
 * arXiv backfill strategy. Iterates the configured categories, paginates the
 * arXiv export API by submittedDate within the window, and emits one
 * ScrapedItem per paper with `sourceOrigin: 'direct_archive'`.
 *
 * Rate-limited to one request per 3 seconds per arXiv robots.txt guidance.
 */
export const arxivStrategy: Strategy = async (ctx: StrategyContext): Promise<StrategyResult> => {
	const items: ScrapedItem[] = [];
	const errors: string[] = [];

	// Shuffle so a 429 on the first iteration does not always penalize the same
	// trailing categories. With fixed order, an arxiv-wide rate-limit budget
	// gets spent on cs.AI every run and cs.LG / cs.CL / cs.SE keep failing on
	// page 0. Randomizing converges to roughly equal attempts per category.
	const categories = [...arxivCategories].sort(() => Math.random() - 0.5);

	for (const category of categories) {
		if (ctx.signal?.aborted) break;

		for (let page = 0; page < ARXIV_MAX_PAGES_PER_CATEGORY; page++) {
			if (ctx.signal?.aborted) break;

			const url = buildArxivUrl(category, ctx.windowStart, ctx.windowEnd, page);
			let xml: string;
			try {
				const response = await fetchArxivWithBackoff(url);
				if (!response.ok) {
					errors.push(`arxiv ${category} page ${page} HTTP ${response.status}`);
					break;
				}
				xml = await response.text();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				errors.push(`arxiv ${category} page ${page} fetch failed: ${message}`);
				break;
			}

			const parsed = parseArxivFeed(xml);
			if (parsed.length === 0) break;

			let kept = 0;
			for (const entry of parsed) {
				if (!entry.link || !entry.title) {
					errors.push(`arxiv ${category} entry missing link/title`);
					continue;
				}
				if (!entry.publishedAt || Number.isNaN(entry.publishedAt.getTime())) {
					errors.push(`arxiv ${category} entry missing publishedAt: ${entry.link}`);
					continue;
				}
				if (!isWithinWindow(entry.publishedAt, ctx.windowStart, ctx.windowEnd)) {
					continue;
				}
				kept++;
				items.push({
					url: entry.link,
					title: entry.title,
					rawContent: entry.summary || entry.title,
					publishedAt: entry.publishedAt,
					author: entry.authorName || undefined,
					sourceName: `arXiv:${category}`,
					sourcePlatform: 'arxiv',
					sourceOrigin: 'direct_archive',
					backfillRunId: ctx.backfillRunId
				});
			}

			// Results are returned newest-first. Once we get a page with no
			// in-window items, older pages will also be out of window.
			if (kept === 0 && parsed.length > 0) break;
			if (parsed.length < ARXIV_PAGE_SIZE) break;
		}
	}

	return { items, errors };
};
