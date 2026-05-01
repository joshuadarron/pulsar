import { redditSubreddits } from '@pulsar/shared/config/sources';
import type { ScrapedItem } from '@pulsar/shared/types';

import { type CdxEntry, streamArchivedHtml } from '../wayback/index.js';
import type { Strategy, StrategyContext, StrategyResult } from './types.js';

type RedditListing = {
	data?: {
		children?: { data?: RedditPostData }[];
	};
};

type RedditPostData = {
	id?: string;
	title?: string;
	url?: string;
	permalink?: string;
	selftext?: string;
	author?: string;
	score?: number;
	num_comments?: number;
	created_utc?: number;
};

function isWithinWindow(date: Date, windowStart: Date, windowEnd: Date): boolean {
	const t = date.getTime();
	return t >= windowStart.getTime() && t <= windowEnd.getTime();
}

function timestampToDate(timestamp: string): Date | null {
	if (timestamp.length < 8) return null;
	const year = Number(timestamp.slice(0, 4));
	const month = Number(timestamp.slice(4, 6));
	const day = Number(timestamp.slice(6, 8));
	const hour = Number(timestamp.slice(8, 10) || '0');
	const minute = Number(timestamp.slice(10, 12) || '0');
	const second = Number(timestamp.slice(12, 14) || '0');
	if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
	const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
	return Number.isNaN(date.getTime()) ? null : date;
}

function tryParseListing(body: string): RedditListing | null {
	const trimmed = body.trimStart();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
	try {
		const parsed = JSON.parse(body) as RedditListing;
		return parsed;
	} catch {
		return null;
	}
}

/**
 * Reddit backfill strategy. Reddit's live API caps at the most recent ~1000
 * posts per subreddit, so historical depth comes from Wayback snapshots of
 * `reddit.com/r/<sub>/new.json`. Items are emitted with `sourceOrigin: 'wayback'`.
 *
 * Note: a future enhancement will mix Reddit's own API for the in-window
 * recent-1000-posts slice with Wayback for older spans. For Phase 2 we keep
 * the strategy single-mode for worker rate-limit simplicity.
 */
export const redditStrategy: Strategy = async (ctx: StrategyContext): Promise<StrategyResult> => {
	const items: ScrapedItem[] = [];
	const errors: string[] = [];
	const seen = new Set<string>();

	for (const sub of redditSubreddits) {
		if (ctx.signal?.aborted) break;

		const urlPattern = `reddit.com/r/${sub}/new.json`;
		let stream: AsyncIterable<{ entry: CdxEntry; html: string }>;
		try {
			stream = streamArchivedHtml(urlPattern, ctx.windowStart, ctx.windowEnd);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`reddit r/${sub} CDX query failed: ${message}`);
			continue;
		}

		try {
			for await (const { entry, html } of stream) {
				if (ctx.signal?.aborted) break;
				const listing = tryParseListing(html);
				if (!listing) {
					errors.push(`reddit r/${sub} entry not JSON: ${entry.timestamp}`);
					continue;
				}
				const children = listing.data?.children ?? [];
				for (const child of children) {
					const post = child.data;
					if (!post) continue;
					if (!post.url || !post.title) continue;
					if (typeof post.created_utc !== 'number') {
						errors.push(`reddit r/${sub} post missing created_utc: ${post.id ?? post.url}`);
						continue;
					}
					const publishedAt = new Date(post.created_utc * 1000);
					if (Number.isNaN(publishedAt.getTime())) continue;
					if (!isWithinWindow(publishedAt, ctx.windowStart, ctx.windowEnd)) continue;

					const articleUrl = post.url.startsWith('/')
						? `https://www.reddit.com${post.permalink ?? post.url}`
						: post.url;
					if (seen.has(articleUrl)) continue;
					seen.add(articleUrl);

					items.push({
						url: articleUrl,
						title: post.title,
						rawContent: post.selftext || post.title,
						publishedAt,
						author: post.author,
						score: post.score,
						commentCount: post.num_comments,
						sourceName: `r/${sub}`,
						sourcePlatform: 'reddit',
						sourceOrigin: 'wayback',
						backfillRunId: ctx.backfillRunId
					});
				}

				// Suppress unused-variable lint for snapshotDate when not used directly,
				// keep it referenced for parity with other strategies.
				void timestampToDate(entry.timestamp);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`reddit r/${sub} stream failed: ${message}`);
		}
	}

	return { items, errors };
};
