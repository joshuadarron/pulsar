import type { SourceAdapter, ScrapedItem } from './types';
import { env } from '@pulsar/shared/config/env';

interface HNHit {
	objectID: string;
	title: string;
	url: string;
	author: string;
	points: number;
	num_comments: number;
	created_at: string;
	story_text?: string;
}

export const hackernews: SourceAdapter = async () => {
	const max = env.scraper.maxItemsPerSource;
	const url = `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=${max}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HN API error: ${res.status}`);

	const data = (await res.json()) as { hits: HNHit[] };

	return data.hits
		.filter((hit) => hit.url)
		.map(
			(hit): ScrapedItem => ({
				url: hit.url,
				title: hit.title,
				rawContent: hit.story_text || hit.title,
				publishedAt: new Date(hit.created_at),
				author: hit.author,
				score: hit.points,
				commentCount: hit.num_comments,
				sourceName: 'Hacker News',
				sourcePlatform: 'hackernews'
			})
		);
};
