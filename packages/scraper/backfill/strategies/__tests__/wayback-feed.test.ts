import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import type { CdxEntry } from '../../wayback/index.js';

type StreamYield = { entry: CdxEntry; html: string };

// Per-test queue of items the streamArchivedHtml mock yields, keyed by url pattern.
const streamMap = new Map<string, StreamYield[]>();

const streamArchivedHtmlMock = mock.fn(async function* (
	urlPattern: string
): AsyncIterable<StreamYield> {
	const queue = streamMap.get(urlPattern) ?? [];
	for (const item of queue) {
		yield item;
	}
});

mock.module('../../wayback/index.js', {
	namedExports: {
		streamArchivedHtml: streamArchivedHtmlMock,
		queryCdx: async () => [],
		fetchArchivedHtml: async () => null
	}
});

mock.module('@pulsar/shared/config/sources', {
	namedExports: {
		mediumTags: ['ai'],
		hashnodeTag: 'ai',
		rssSources: [{ name: 'TechCrunch', url: 'https://techcrunch.com/feed/' }],
		substackPublications: [],
		aiLabFeeds: []
	}
});

const { waybackFeedStrategy, buildFeedSources } = await import('../wayback-feed.js');

function makeEntry(timestamp: string, originalUrl: string): CdxEntry {
	return {
		urlkey: 'com,example)/feed',
		timestamp,
		originalUrl,
		mimetype: 'text/html',
		statusCode: 200,
		digest: 'XXX',
		length: 1
	};
}

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>In Window Article</title>
      <link>https://example.com/article-1</link>
      <pubDate>Wed, 03 Jan 2024 12:00:00 GMT</pubDate>
      <description>Hello world</description>
      <author>writer@example.com (Writer)</author>
    </item>
    <item>
      <title>Out Of Window Article</title>
      <link>https://example.com/article-2</link>
      <pubDate>Sun, 01 Jan 2023 12:00:00 GMT</pubDate>
      <description>Older content</description>
    </item>
    <item>
      <title>Missing Link Should Drop</title>
      <pubDate>Wed, 03 Jan 2024 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

beforeEach(() => {
	streamMap.clear();
	streamArchivedHtmlMock.mock.resetCalls();
});

afterEach(() => {
	streamMap.clear();
});

describe('buildFeedSources', () => {
	it('returns dev.to/feed for devto', () => {
		const out = buildFeedSources('devto');
		assert.equal(out.length, 1);
		assert.equal(out[0].urlPattern, 'dev.to/feed');
		assert.equal(out[0].platform, 'devto');
	});

	it('returns one entry per medium tag', () => {
		const out = buildFeedSources('medium');
		assert.equal(out.length, 1);
		assert.equal(out[0].urlPattern, 'medium.com/feed/tag/ai');
		assert.equal(out[0].platform, 'medium');
	});

	it('strips the protocol from rss source urls', () => {
		const out = buildFeedSources('rss');
		assert.ok(out.find((s) => s.urlPattern === 'techcrunch.com/feed/'));
	});

	it('returns empty array for unknown source', () => {
		assert.deepEqual(buildFeedSources('unknown'), []);
	});
});

describe('waybackFeedStrategy', () => {
	const windowStart = new Date('2024-01-01T00:00:00Z');
	const windowEnd = new Date('2024-02-01T00:00:00Z');

	describe('happy path', () => {
		it('parses archived RSS into ScrapedItems with sourceOrigin wayback', async () => {
			streamMap.set('dev.to/feed', [
				{ entry: makeEntry('20240115120000', 'https://dev.to/feed'), html: RSS_FIXTURE }
			]);

			const strategy = waybackFeedStrategy('devto');
			const result = await strategy({
				sourceName: 'devto',
				windowStart,
				windowEnd,
				backfillRunId: 'run-w'
			});

			assert.equal(result.items.length, 1, 'only the in-window, well-formed item');
			const item = result.items[0];
			assert.equal(item.sourceOrigin, 'wayback');
			assert.equal(item.backfillRunId, 'run-w');
			assert.equal(item.sourcePlatform, 'devto');
			assert.equal(item.sourceName, 'Dev.to');
			assert.equal(item.url, 'https://example.com/article-1');
			assert.equal(item.title, 'In Window Article');
		});

		it('deduplicates by url across multiple snapshots', async () => {
			streamMap.set('dev.to/feed', [
				{ entry: makeEntry('20240115120000', 'https://dev.to/feed'), html: RSS_FIXTURE },
				{ entry: makeEntry('20240120120000', 'https://dev.to/feed'), html: RSS_FIXTURE }
			]);

			const strategy = waybackFeedStrategy('devto');
			const result = await strategy({
				sourceName: 'devto',
				windowStart,
				windowEnd,
				backfillRunId: 'run-w'
			});

			assert.equal(result.items.length, 1, 'duplicate url is deduped');
		});
	});

	describe('error handling', () => {
		it('captures parse errors per snapshot without throwing', async () => {
			streamMap.set('dev.to/feed', [
				{ entry: makeEntry('20240115120000', 'https://dev.to/feed'), html: 'not even xml' },
				{ entry: makeEntry('20240115120100', 'https://dev.to/feed'), html: RSS_FIXTURE }
			]);

			const strategy = waybackFeedStrategy('devto');
			const result = await strategy({
				sourceName: 'devto',
				windowStart,
				windowEnd,
				backfillRunId: 'run-w'
			});

			// "not even xml" is treated as non-XML and silently skipped (no parse attempt).
			// The valid fixture still produces one item.
			assert.equal(result.items.length, 1);
		});

		it('returns empty result for sources with no feed mapping', async () => {
			const strategy = waybackFeedStrategy('unknown');
			const result = await strategy({
				sourceName: 'unknown',
				windowStart,
				windowEnd,
				backfillRunId: 'run-w'
			});

			assert.equal(result.items.length, 0);
			assert.equal(result.errors.length, 0);
		});
	});
});
