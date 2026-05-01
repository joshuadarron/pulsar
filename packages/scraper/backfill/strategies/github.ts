import { env } from '@pulsar/shared/config/env';
import { githubSearchQueries } from '@pulsar/shared/config/sources';
import type { ScrapedItem } from '@pulsar/shared/types';

import type { Strategy, StrategyContext, StrategyResult } from './types.js';

const GITHUB_SEARCH_ENDPOINT = 'https://api.github.com/search/repositories';
const GITHUB_PER_PAGE = 100;
const GITHUB_MAX_PAGES = 10;
const GITHUB_RATE_LIMIT_MS_AUTH = 1000;
const GITHUB_RATE_LIMIT_MS_UNAUTH = 2500;

let lastGithubRequestAt = 0;

/** Reset the in-process rate limiter. Test-only. */
export function __resetGithubRateLimiterForTesting(): void {
	lastGithubRequestAt = 0;
}

async function sleep(ms: number): Promise<void> {
	if (ms <= 0) return;
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyGithubRateLimit(hasToken: boolean): Promise<void> {
	const limit = hasToken ? GITHUB_RATE_LIMIT_MS_AUTH : GITHUB_RATE_LIMIT_MS_UNAUTH;
	const now = Date.now();
	const elapsed = now - lastGithubRequestAt;
	const wait = limit - elapsed;
	if (wait > 0) await sleep(wait);
	lastGithubRequestAt = Date.now();
}

function formatGithubDate(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const year = date.getUTCFullYear();
	const month = pad(date.getUTCMonth() + 1);
	const day = pad(date.getUTCDate());
	return `${year}-${month}-${day}`;
}

function buildGithubUrl(query: string, windowStart: Date, windowEnd: Date, page: number): string {
	const range = `${formatGithubDate(windowStart)}..${formatGithubDate(windowEnd)}`;
	const composedQuery = `${query} created:${range}`;
	const params = new URLSearchParams({
		q: composedQuery,
		sort: 'stars',
		order: 'desc',
		per_page: String(GITHUB_PER_PAGE),
		page: String(page)
	});
	return `${GITHUB_SEARCH_ENDPOINT}?${params.toString()}`;
}

type GithubRepo = {
	html_url?: string;
	full_name?: string;
	description?: string | null;
	owner?: { login?: string };
	stargazers_count?: number;
	pushed_at?: string;
	created_at?: string;
};

type GithubSearchResponse = {
	total_count?: number;
	incomplete_results?: boolean;
	items?: GithubRepo[];
};

function isWithinWindow(date: Date, windowStart: Date, windowEnd: Date): boolean {
	const t = date.getTime();
	return t >= windowStart.getTime() && t <= windowEnd.getTime();
}

/**
 * GitHub backfill strategy. Uses the search API's `created:<range>` qualifier
 * to find repositories created within the window, ordered by star count.
 * Requires `GITHUB_TOKEN` for production-scale rates; falls back to
 * unauthenticated requests at a slower rate when absent.
 */
export const githubStrategy: Strategy = async (ctx: StrategyContext): Promise<StrategyResult> => {
	const items: ScrapedItem[] = [];
	const errors: string[] = [];
	const token = env.github.token;
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github.v3+json',
		'User-Agent': 'pulsar-backfill/0.1'
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	const seen = new Set<string>();

	for (const query of githubSearchQueries) {
		if (ctx.signal?.aborted) break;

		for (let page = 1; page <= GITHUB_MAX_PAGES; page++) {
			if (ctx.signal?.aborted) break;
			const url = buildGithubUrl(query, ctx.windowStart, ctx.windowEnd, page);
			let response: Response;
			try {
				await applyGithubRateLimit(Boolean(token));
				response = await fetch(url, { headers });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				errors.push(`github query "${query}" page ${page} fetch failed: ${message}`);
				break;
			}

			if (response.status === 403 || response.status === 429) {
				errors.push(`github query "${query}" page ${page} rate limited (HTTP ${response.status})`);
				break;
			}
			if (!response.ok) {
				errors.push(`github query "${query}" page ${page} HTTP ${response.status}`);
				break;
			}

			let data: GithubSearchResponse;
			try {
				data = (await response.json()) as GithubSearchResponse;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				errors.push(`github query "${query}" page ${page} parse failed: ${message}`);
				break;
			}

			const repos = Array.isArray(data.items) ? data.items : [];
			if (repos.length === 0) break;

			for (const repo of repos) {
				if (!repo.html_url || !repo.full_name) continue;
				const createdRaw = repo.created_at ?? repo.pushed_at;
				if (!createdRaw) {
					errors.push(`github repo missing dates: ${repo.full_name}`);
					continue;
				}
				const publishedAt = new Date(createdRaw);
				if (Number.isNaN(publishedAt.getTime())) {
					errors.push(`github repo invalid date: ${repo.full_name} (${createdRaw})`);
					continue;
				}
				if (!isWithinWindow(publishedAt, ctx.windowStart, ctx.windowEnd)) continue;
				if (seen.has(repo.html_url)) continue;
				seen.add(repo.html_url);

				items.push({
					url: repo.html_url,
					title: repo.full_name,
					rawContent: repo.description || repo.full_name,
					publishedAt,
					author: repo.owner?.login,
					score: repo.stargazers_count,
					sourceName: 'GitHub',
					sourcePlatform: 'github',
					sourceOrigin: 'direct_archive',
					backfillRunId: ctx.backfillRunId
				});
			}

			if (repos.length < GITHUB_PER_PAGE) break;
		}
	}

	return { items, errors };
};
