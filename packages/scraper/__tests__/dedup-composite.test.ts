import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dedupArticlesByOrigin, hashComposite } from '../dedup.js';

describe('hashComposite', () => {
	describe('format', () => {
		it('returns a 64-character lowercase hex string', () => {
			const hash = hashComposite(
				'hackernews',
				new Date('2024-01-15T08:30:00Z'),
				'https://example.com/a'
			);
			assert.match(hash, /^[a-f0-9]{64}$/);
		});
	});

	describe('determinism', () => {
		it('returns the same hash for identical inputs', () => {
			const a = hashComposite(
				'reddit',
				new Date('2023-06-01T00:00:00Z'),
				'https://reddit.com/r/foo/x'
			);
			const b = hashComposite(
				'reddit',
				new Date('2023-06-01T00:00:00Z'),
				'https://reddit.com/r/foo/x'
			);
			assert.equal(a, b);
		});
	});

	describe('distinctness', () => {
		it('produces different hashes for different sourceNames', () => {
			const date = new Date('2024-01-15T08:30:00Z');
			const url = 'https://example.com/a';
			assert.notEqual(hashComposite('hackernews', date, url), hashComposite('reddit', date, url));
		});

		it('produces different hashes for different publishedAt timestamps', () => {
			const url = 'https://example.com/a';
			const a = hashComposite('hackernews', new Date('2024-01-15T08:30:00Z'), url);
			const b = hashComposite('hackernews', new Date('2024-01-16T08:30:00Z'), url);
			assert.notEqual(a, b);
		});
	});

	describe('url normalization', () => {
		it('strips query strings before hashing', () => {
			const date = new Date('2024-01-15T08:30:00Z');
			const a = hashComposite('hackernews', date, 'https://example.com/article');
			const b = hashComposite(
				'hackernews',
				date,
				'https://example.com/article?utm_source=foo&utm_medium=bar'
			);
			assert.equal(a, b);
		});

		it('strips fragments before hashing', () => {
			const date = new Date('2024-01-15T08:30:00Z');
			const a = hashComposite('hackernews', date, 'https://example.com/article');
			const b = hashComposite('hackernews', date, 'https://example.com/article#section-2');
			assert.equal(a, b);
		});

		it('treats trailing-slash variants as the same URL', () => {
			const date = new Date('2024-01-15T08:30:00Z');
			const a = hashComposite('hackernews', date, 'https://example.com/article');
			const b = hashComposite('hackernews', date, 'https://example.com/article/');
			assert.equal(a, b);
		});

		it('lowercases the host and path before hashing', () => {
			const date = new Date('2024-01-15T08:30:00Z');
			const a = hashComposite('hackernews', date, 'HTTPS://Example.COM/Article');
			const b = hashComposite('hackernews', date, 'https://example.com/article');
			assert.equal(a, b);
		});
	});
});

describe('dedupArticlesByOrigin', () => {
	const baseRow = {
		id: 'a',
		rawId: 'r',
		title: 't',
		publishedAt: new Date('2024-01-15T00:00:00Z'),
		sourceName: 's',
		sourcePlatform: 'p',
		runId: 'run'
	};

	it('keeps the live row when both live and backfilled rows share a URL', () => {
		const live = {
			...baseRow,
			id: 'live',
			url: 'https://example.com/x',
			sourceOrigin: 'live' as const
		};
		const wayback = {
			...baseRow,
			id: 'wb',
			url: 'https://example.com/x',
			sourceOrigin: 'wayback' as const
		};
		const out = dedupArticlesByOrigin([wayback, live]);
		assert.equal(out.length, 1);
		assert.equal(out[0].id, 'live');
	});

	it('keeps the backfill row when no live row exists', () => {
		const wayback = {
			...baseRow,
			id: 'wb',
			url: 'https://example.com/y',
			sourceOrigin: 'wayback' as const
		};
		const out = dedupArticlesByOrigin([wayback]);
		assert.equal(out.length, 1);
		assert.equal(out[0].id, 'wb');
	});

	it('treats undefined sourceOrigin as live', () => {
		const a = { ...baseRow, id: 'a', url: 'https://example.com/z' };
		const b = {
			...baseRow,
			id: 'b',
			url: 'https://example.com/z',
			sourceOrigin: 'wayback' as const
		};
		const out = dedupArticlesByOrigin([b, a]);
		assert.equal(out.length, 1);
		assert.equal(out[0].id, 'a');
	});
});
