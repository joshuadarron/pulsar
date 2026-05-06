import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

mock.module('@pulsar/shared/config/env', {
	namedExports: {
		env: { scraper: { maxItemsPerSource: 4 } }
	}
});

mock.module('@pulsar/shared/config/sources', {
	namedExports: {
		redditSubreddits: ['hangs', 'works']
	}
});

const { reddit } = await import('../sources/reddit.js');

type FetchCall = { url: string; signal: AbortSignal | null };

describe('reddit adapter timeout handling', () => {
	const realFetch = globalThis.fetch;
	let calls: FetchCall[];

	beforeEach(() => {
		calls = [];
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('passes an AbortSignal to fetch so a hung response can self-cancel', async () => {
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			calls.push({ url, signal: init?.signal ?? null });
			return new Response(JSON.stringify({ data: { children: [] } }), { status: 200 });
		}) as typeof fetch;

		await reddit();

		assert.ok(calls.length > 0, 'reddit adapter should call fetch');
		for (const call of calls) {
			assert.ok(call.signal instanceof AbortSignal, 'fetch must be called with an AbortSignal');
		}
	});

	it('continues to the next subreddit when one fetch aborts', async () => {
		globalThis.fetch = (async (url: string) => {
			if (url.includes('/r/hangs/')) {
				const err = new Error('The operation was aborted');
				err.name = 'AbortError';
				throw err;
			}
			return new Response(
				JSON.stringify({
					data: {
						children: [
							{
								data: {
									title: 'ok',
									url: 'https://example.com/post',
									permalink: '/r/works/comments/1/ok',
									selftext: '',
									author: 'me',
									score: 1,
									num_comments: 0,
									created_utc: 1700000000
								}
							}
						]
					}
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		const items = await reddit();

		assert.equal(items.length, 1, 'works subreddit should still produce an item');
		assert.equal(items[0].sourceName, 'r/works');
	});

	it('returns no items but does not throw when every subreddit aborts', async () => {
		globalThis.fetch = (async () => {
			const err = new Error('The operation was aborted');
			err.name = 'AbortError';
			throw err;
		}) as typeof fetch;

		const items = await reddit();

		assert.deepEqual(items, []);
	});
});
