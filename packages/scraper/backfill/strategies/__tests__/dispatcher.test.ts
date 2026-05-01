import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getStrategy, strategies } from '../index.js';

describe('getStrategy', () => {
	it('returns a registered strategy for arxiv', () => {
		const strategy = getStrategy('arxiv');
		assert.equal(typeof strategy, 'function');
	});

	it('returns a registered strategy for hackernews', () => {
		const strategy = getStrategy('hackernews');
		assert.equal(typeof strategy, 'function');
	});

	it('returns a registered strategy for each wayback-feed source', () => {
		for (const source of ['hashnode', 'medium', 'devto', 'rss']) {
			assert.equal(typeof getStrategy(source), 'function', `missing strategy for ${source}`);
		}
	});

	it('throws on unknown source', () => {
		assert.throws(() => getStrategy('does-not-exist'), /No backfill strategy/);
	});
});

describe('strategies registry', () => {
	it('registers exactly the eight expected sources', () => {
		const keys = Object.keys(strategies).sort();
		assert.deepEqual(keys, [
			'arxiv',
			'devto',
			'github',
			'hackernews',
			'hashnode',
			'medium',
			'reddit',
			'rss'
		]);
	});
});
