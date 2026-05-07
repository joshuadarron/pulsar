import { env } from '@pulsar/shared/config/env';
import { redditSubreddits } from '@pulsar/shared/config/sources';
import type { ScrapedItem, SourceAdapter } from './types';

interface RedditPost {
	data: {
		title: string;
		url: string;
		permalink: string;
		selftext: string;
		author: string;
		score: number;
		num_comments: number;
		created_utc: number;
	};
}

// Reddit's edge has, on rare occasions, hung mid-response and never closed the
// socket, which previously froze the entire scheduled scrape (Node fetch has
// no default socket timeout). 15s is a comfortable upper bound; healthy
// responses come back well under 1s. The timeout must cover the entire
// transaction, not just headers, because a stalled body stream after a 200
// response has the same hang signature.
const REDDIT_FETCH_TIMEOUT_MS = 15_000;

// If a single subreddit takes longer than this, log it so a future hang has a
// visible trail. Quiet on the happy path.
const REDDIT_SLOW_SUBREDDIT_MS = 5_000;

export const reddit: SourceAdapter = async () => {
	const max = env.scraper.maxItemsPerSource;
	const perSub = Math.ceil(max / redditSubreddits.length);
	const items: ScrapedItem[] = [];

	for (const sub of redditSubreddits) {
		const startedAt = Date.now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REDDIT_FETCH_TIMEOUT_MS);
		try {
			const url = `https://www.reddit.com/r/${sub}/hot.json?limit=${perSub}`;
			const res = await fetch(url, {
				headers: { 'User-Agent': 'pulsar-scraper/0.1' },
				signal: controller.signal
			});
			if (!res.ok) continue;

			// Read body via .text() (and parse manually) rather than .json(): both
			// honor the signal in undici, but text() makes the bound timeout
			// obvious in the call stack if a hang ever recurs.
			const body = await res.text();
			const data = JSON.parse(body) as {
				data: { children: RedditPost[] };
			};

			for (const post of data.data.children) {
				const d = post.data;
				const articleUrl = d.url.startsWith('/') ? `https://www.reddit.com${d.permalink}` : d.url;

				items.push({
					url: articleUrl,
					title: d.title,
					rawContent: d.selftext || d.title,
					publishedAt: new Date(d.created_utc * 1000),
					author: d.author,
					score: d.score,
					commentCount: d.num_comments,
					sourceName: `r/${sub}`,
					sourcePlatform: 'reddit'
				});
			}
		} catch (err) {
			console.warn(`Failed to fetch r/${sub}:`, err);
		} finally {
			clearTimeout(timer);
			const elapsedMs = Date.now() - startedAt;
			if (elapsedMs > REDDIT_SLOW_SUBREDDIT_MS) {
				console.warn(`Slow subreddit r/${sub}: ${elapsedMs}ms`);
			}
		}
	}

	return items.slice(0, max);
};
