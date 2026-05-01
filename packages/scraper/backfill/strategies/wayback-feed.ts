import RSSParser from 'rss-parser';

import {
	aiLabFeeds,
	hashnodeTag,
	mediumTags,
	rssSources,
	substackPublications
} from '@pulsar/shared/config/sources';
import type { ScrapedItem } from '@pulsar/shared/types';

import { type CdxEntry, streamArchivedHtml } from '../wayback/index.js';
import type { Strategy, StrategyContext, StrategyResult } from './types.js';

type WaybackFeedSource = {
	urlPattern: string;
	displayName: string;
	platform: string;
	category?: string;
};

const parser = new RSSParser();

/**
 * URL patterns the Wayback CDX index will be queried against, per source name.
 * The patterns mirror the live feed URLs that the same source's adapter would
 * fetch today, so historical snapshots map naturally onto live ingestion shape.
 */
export function buildFeedSources(sourceName: string): WaybackFeedSource[] {
	switch (sourceName) {
		case 'devto':
			return [
				{
					urlPattern: 'dev.to/feed',
					displayName: 'Dev.to',
					platform: 'devto'
				}
			];
		case 'medium':
			return mediumTags.map((tag) => ({
				urlPattern: `medium.com/feed/tag/${tag}`,
				displayName: `Medium/${tag}`,
				platform: 'medium'
			}));
		case 'hashnode':
			return [
				{
					urlPattern: `hashnode.com/n/${hashnodeTag}/rss`,
					displayName: 'Hashnode',
					platform: 'hashnode'
				}
			];
		case 'rss': {
			const sources: WaybackFeedSource[] = [];
			for (const source of rssSources) {
				sources.push({
					urlPattern: source.url.replace(/^https?:\/\//, ''),
					displayName: source.name,
					platform: 'rss'
				});
			}
			for (const source of substackPublications) {
				sources.push({
					urlPattern: source.url.replace(/^https?:\/\//, ''),
					displayName: source.name,
					platform: 'substack'
				});
			}
			for (const source of aiLabFeeds) {
				sources.push({
					urlPattern: source.url.replace(/^https?:\/\//, ''),
					displayName: source.name,
					platform: 'rss',
					category: source.category
				});
			}
			return sources;
		}
		default:
			return [];
	}
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

function isWithinWindow(date: Date, windowStart: Date, windowEnd: Date): boolean {
	const t = date.getTime();
	return t >= windowStart.getTime() && t <= windowEnd.getTime();
}

function looksLikeXml(body: string): boolean {
	const trimmed = body.trimStart();
	return trimmed.startsWith('<?xml') || trimmed.startsWith('<rss') || trimmed.startsWith('<feed');
}

type ParsedFeedItem = {
	url: string;
	title: string;
	contentSnippet: string;
	publishedAt: Date;
	author?: string;
};

async function parseFeedBody(body: string, fallbackDate: Date): Promise<ParsedFeedItem[]> {
	if (!looksLikeXml(body)) return [];
	const feed = await parser.parseString(body);
	const out: ParsedFeedItem[] = [];
	for (const entry of feed.items) {
		if (!entry.link || !entry.title) continue;
		const pub = entry.isoDate
			? new Date(entry.isoDate)
			: entry.pubDate
				? new Date(entry.pubDate)
				: fallbackDate;
		const valid = pub && !Number.isNaN(pub.getTime()) ? pub : fallbackDate;
		out.push({
			url: entry.link,
			title: entry.title,
			contentSnippet: entry.contentSnippet || entry.title,
			publishedAt: valid,
			author: entry.creator
		});
	}
	return out;
}

function makeWaybackFeedStrategy(sourceName: string): Strategy {
	return async (ctx: StrategyContext): Promise<StrategyResult> => {
		const items: ScrapedItem[] = [];
		const errors: string[] = [];
		const feedSources = buildFeedSources(sourceName);
		const seen = new Set<string>();

		for (const feed of feedSources) {
			if (ctx.signal?.aborted) break;
			let stream: AsyncIterable<{ entry: CdxEntry; html: string }>;
			try {
				stream = streamArchivedHtml(feed.urlPattern, ctx.windowStart, ctx.windowEnd);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				errors.push(`${sourceName} ${feed.urlPattern} CDX query failed: ${message}`);
				continue;
			}

			try {
				for await (const { entry, html } of stream) {
					if (ctx.signal?.aborted) break;
					const snapshotDate = timestampToDate(entry.timestamp);
					if (!snapshotDate) {
						errors.push(`${sourceName} entry has invalid timestamp: ${entry.timestamp}`);
						continue;
					}

					let parsed: ParsedFeedItem[];
					try {
						parsed = await parseFeedBody(html, snapshotDate);
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						errors.push(
							`${sourceName} parse failed for ${entry.originalUrl}@${entry.timestamp}: ${message}`
						);
						continue;
					}

					if (parsed.length === 0) continue;

					for (const item of parsed) {
						if (!isWithinWindow(item.publishedAt, ctx.windowStart, ctx.windowEnd)) continue;
						if (seen.has(item.url)) continue;
						seen.add(item.url);
						items.push({
							url: item.url,
							title: item.title,
							rawContent: item.contentSnippet,
							publishedAt: item.publishedAt,
							author: item.author,
							sourceName: feed.displayName,
							sourcePlatform: feed.platform,
							sourceOrigin: 'wayback',
							backfillRunId: ctx.backfillRunId,
							...(feed.category ? { sourceCategory: feed.category } : {})
						});
					}
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				errors.push(`${sourceName} ${feed.urlPattern} stream failed: ${message}`);
			}
		}

		return { items, errors };
	};
}

export const waybackFeedStrategy = makeWaybackFeedStrategy;
