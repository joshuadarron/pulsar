import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { __resetHackernewsRateLimiterForTesting, hackernewsStrategy } from '../hackernews.js';

type FetchCall = { url: string };

let fetchCalls: FetchCall[] = [];
let fetchQueue: Array<() => Response | Promise<Response>> = [];
const realFetch = globalThis.fetch;

function installFetchStub(): void {
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		fetchCalls.push({ url });
		const next = fetchQueue.shift();
		if (!next) throw new Error(`Unexpected fetch call: ${url}`);
		return next();
	}) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

beforeEach(() => {
	fetchCalls = [];
	fetchQueue = [];
	__resetHackernewsRateLimiterForTesting();
	installFetchStub();
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

function buildHit(idx: number, createdSec: number) {
	return {
		objectID: `hn-${idx}`,
		title: `Story ${idx}`,
		url: `https://example.com/${idx}`,
		author: 'someuser',
		points: 100,
		num_comments: 12,
		created_at_i: createdSec,
		created_at: new Date(createdSec * 1000).toISOString()
	};
}

describe('hackernewsStrategy', () => {
	const windowStart = new Date('2024-01-01T00:00:00Z');
	const windowEnd = new Date('2024-01-08T00:00:00Z');

	describe('pagination', () => {
		it('terminates when a page returns fewer than HN_HITS_PER_PAGE', async () => {
			const inWindowSec = Math.floor(windowStart.getTime() / 1000) + 3600;
			fetchQueue.push(() =>
				jsonResponse({
					hits: [buildHit(1, inWindowSec), buildHit(2, inWindowSec + 60)],
					page: 0,
					nbPages: 1
				})
			);

			const result = await hackernewsStrategy({
				sourceName: 'hackernews',
				windowStart,
				windowEnd,
				backfillRunId: 'run-x'
			});

			assert.equal(result.items.length, 2);
			assert.equal(fetchCalls.length, 1, 'one page only');
			for (const item of result.items) {
				assert.equal(item.sourceOrigin, 'direct_archive');
				assert.equal(item.backfillRunId, 'run-x');
				assert.equal(item.sourcePlatform, 'hackernews');
			}
		});

		it('terminates when nbPages is reached even with full page', async () => {
			const inWindowSec = Math.floor(windowStart.getTime() / 1000) + 3600;
			const fullPage = Array.from({ length: 100 }, (_, i) => buildHit(i, inWindowSec + i));
			fetchQueue.push(() => jsonResponse({ hits: fullPage, page: 0, nbPages: 1 }));

			const result = await hackernewsStrategy({
				sourceName: 'hackernews',
				windowStart,
				windowEnd,
				backfillRunId: 'run-y'
			});

			assert.equal(result.items.length, 100);
			assert.equal(fetchCalls.length, 1);
		});

		it('terminates when an empty hits array is returned', async () => {
			fetchQueue.push(() => jsonResponse({ hits: [], page: 0, nbPages: 5 }));

			const result = await hackernewsStrategy({
				sourceName: 'hackernews',
				windowStart,
				windowEnd,
				backfillRunId: 'run-z'
			});

			assert.equal(result.items.length, 0);
			assert.equal(fetchCalls.length, 1);
		});
	});

	describe('filtering', () => {
		it('drops out-of-window hits', async () => {
			const inWindowSec = Math.floor(windowStart.getTime() / 1000) + 3600;
			const outOfWindowSec = Math.floor(windowStart.getTime() / 1000) - 3600;
			fetchQueue.push(() =>
				jsonResponse({
					hits: [buildHit(1, inWindowSec), buildHit(2, outOfWindowSec)],
					page: 0,
					nbPages: 1
				})
			);

			const result = await hackernewsStrategy({
				sourceName: 'hackernews',
				windowStart,
				windowEnd,
				backfillRunId: 'run-a'
			});

			assert.equal(result.items.length, 1);
			assert.equal(result.items[0].title, 'Story 1');
		});

		it('drops hits with no url', async () => {
			const inWindowSec = Math.floor(windowStart.getTime() / 1000) + 3600;
			const hit = buildHit(1, inWindowSec);
			(hit as { url?: string }).url = undefined;
			fetchQueue.push(() => jsonResponse({ hits: [hit], page: 0, nbPages: 1 }));

			const result = await hackernewsStrategy({
				sourceName: 'hackernews',
				windowStart,
				windowEnd,
				backfillRunId: 'run-b'
			});

			assert.equal(result.items.length, 0);
		});
	});

	describe('error handling', () => {
		it('records HTTP errors and stops paginating that batch', async () => {
			fetchQueue.push(() => new Response('rate limited', { status: 429 }));

			const result = await hackernewsStrategy({
				sourceName: 'hackernews',
				windowStart,
				windowEnd,
				backfillRunId: 'run-c'
			});

			assert.equal(result.items.length, 0);
			assert.equal(result.errors.length, 1);
			assert.match(result.errors[0], /HTTP 429/);
		});
	});
});
