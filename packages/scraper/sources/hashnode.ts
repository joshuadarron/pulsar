import type { SourceAdapter, ScrapedItem } from './types';
import { hashnodeTag } from '@pulsar/shared/config/sources';
import { env } from '@pulsar/shared/config/env';

interface HashnodePost {
	title: string;
	brief: string;
	url: string;
	publishedAt: string;
	author: { username: string };
	reactionCount: number;
	replyCount: number;
}

export const hashnode: SourceAdapter = async () => {
	const max = env.scraper.maxItemsPerSource;

	const query = `
    query {
      feed(first: ${max}, filter: { tags: ["${hashnodeTag}"] }) {
        edges {
          node {
            title
            brief
            url
            publishedAt
            author { username }
            reactionCount
            replyCount
          }
        }
      }
    }
  `;

	try {
		const res = await fetch('https://gql.hashnode.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query })
		});

		if (!res.ok) throw new Error(`Hashnode API error: ${res.status}`);

		const data = (await res.json()) as {
			data: { feed: { edges: { node: HashnodePost }[] } };
		};

		return (data.data?.feed?.edges || []).map(
			({ node }): ScrapedItem => ({
				url: node.url,
				title: node.title,
				rawContent: node.brief || node.title,
				publishedAt: new Date(node.publishedAt),
				author: node.author?.username,
				score: node.reactionCount,
				commentCount: node.replyCount,
				sourceName: 'Hashnode',
				sourcePlatform: 'hashnode'
			})
		);
	} catch (err) {
		console.warn('Failed Hashnode fetch:', err);
		return [];
	}
};
