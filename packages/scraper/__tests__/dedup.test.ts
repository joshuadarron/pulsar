import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { hashUrl } from '../dedup.js';

describe('hashUrl', () => {
	describe('format', () => {
		it('returns a 64-character lowercase hex string', () => {
			const hash = hashUrl('https://example.com/article');
			assert.match(hash, /^[a-f0-9]{64}$/);
		});
	});

	describe('normalization', () => {
		it('produces the same hash for trim and case variants', () => {
			const a = hashUrl('  HTTP://Foo.com/  ');
			const b = hashUrl('http://foo.com/');
			assert.equal(a, b);
		});

		it('is deterministic for repeated input', () => {
			const url = 'https://example.com/path?x=1';
			assert.equal(hashUrl(url), hashUrl(url));
		});
	});

	describe('distinctness', () => {
		it('produces different hashes for different hosts', () => {
			assert.notEqual(hashUrl('https://a.com/'), hashUrl('https://b.com/'));
		});

		it('treats trailing-slash variants as distinct (documents current behavior)', () => {
			assert.notEqual(hashUrl('https://example.com'), hashUrl('https://example.com/'));
		});
	});
});
