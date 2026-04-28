import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Fixture: pre-parsed RSS feed data (matches rss-parser output shape)
const FIXTURE_FEED = {
	items: [
		{
			title: 'Scaling Laws for Neural Language Models',
			link: 'https://ailab.example.com/blog/scaling-laws',
			contentSnippet: 'We investigate the scaling properties of Transformer language models.',
			pubDate: 'Mon, 21 Apr 2026 12:00:00 GMT',
			creator: 'Research Team'
		},
		{
			title: 'New Approaches to RLHF',
			link: 'https://ailab.example.com/blog/rlhf-approaches',
			contentSnippet: 'A study on reinforcement learning from human feedback techniques.',
			pubDate: 'Sun, 20 Apr 2026 10:00:00 GMT'
		}
	]
};

const mockParseURL = mock.fn(async () => FIXTURE_FEED);

mock.module('rss-parser', {
	defaultExport: class {
		parseURL = mockParseURL;
	}
});

mock.module('@pulsar/shared/config/env', {
	namedExports: {
		env: {
			scraper: { maxItemsPerSource: 200 }
		}
	}
});

describe('RSS ai-lab adapter', () => {
	beforeEach(() => {
		mockParseURL.mock.resetCalls();
	});

	it("produces ScrapedItems with sourceCategory 'ai-lab' for ai-lab feeds", async () => {
		const { rss } = await import('../rss.js');
		const items = await rss();

		const aiLabItems = items.filter((item) => item.sourceCategory === 'ai-lab');
		assert.ok(aiLabItems.length > 0, 'Expected at least one ai-lab item');

		const first = aiLabItems[0];
		assert.equal(first.sourceCategory, 'ai-lab');
		assert.equal(first.sourcePlatform, 'rss');
		assert.ok(first.url.length > 0, 'url should be non-empty');
		assert.ok(first.title.length > 0, 'title should be non-empty');
		assert.ok(first.rawContent.length > 0, 'rawContent should be non-empty');
		assert.ok(first.publishedAt instanceof Date, 'publishedAt should be a Date');
		assert.ok(first.sourceName.length > 0, 'sourceName should be non-empty');
	});

	it('does not set sourceCategory on regular RSS feeds', async () => {
		const { rss } = await import('../rss.js');
		const items = await rss();

		const regularItems = items.filter(
			(item) => item.sourceName === 'TechCrunch' || item.sourceName === 'The Verge'
		);
		assert.ok(regularItems.length > 0, 'Expected regular RSS items');
		for (const item of regularItems) {
			assert.equal(item.sourceCategory, undefined);
		}
	});
});
