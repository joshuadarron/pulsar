import type { SourceAdapter, ScrapedItem } from './types';
import { env } from '@pulsar/shared/config/env';

interface DevToArticle {
	url: string;
	title: string;
	description: string;
	published_at: string;
	user: { username: string };
	positive_reactions_count: number;
	comments_count: number;
}

export const devto: SourceAdapter = async () => {
	const max = env.scraper.maxItemsPerSource;
	const url = `https://dev.to/api/articles?per_page=${max}&top=1`;

	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Dev.to API error: ${res.status}`);

		const articles = (await res.json()) as DevToArticle[];

		return articles.map(
			(a): ScrapedItem => ({
				url: a.url,
				title: a.title,
				rawContent: a.description || a.title,
				publishedAt: new Date(a.published_at),
				author: a.user.username,
				score: a.positive_reactions_count,
				commentCount: a.comments_count,
				sourceName: 'Dev.to',
				sourcePlatform: 'devto'
			})
		);
	} catch (err) {
		console.warn('Failed Dev.to fetch:', err);
		return [];
	}
};
