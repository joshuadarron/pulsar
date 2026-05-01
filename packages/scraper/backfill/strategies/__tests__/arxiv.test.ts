import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

mock.module('@pulsar/shared/config/sources', {
	namedExports: {
		arxivCategories: ['cs.AI']
	}
});

const { arxivStrategy, __resetArxivRateLimiterForTesting } = await import('../arxiv.js');

const FIXTURE_PATH = new URL('./fixtures/arxiv-page-1.xml', import.meta.url);

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

function xmlResponse(body: string, status = 200): Response {
	return new Response(body, { status, headers: { 'Content-Type': 'application/atom+xml' } });
}

beforeEach(() => {
	fetchCalls = [];
	fetchQueue = [];
	__resetArxivRateLimiterForTesting();
	installFetchStub();
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('arxivStrategy', () => {
	describe('happy path', () => {
		it('emits ScrapedItems with sourceOrigin direct_archive and backfillRunId set', async () => {
			const xml = await readFile(FIXTURE_PATH, 'utf8');
			fetchQueue.push(() => xmlResponse(xml));
			// Second fetch returns empty page so loop terminates after page 0.
			fetchQueue.push(() => xmlResponse('<feed></feed>'));

			const result = await arxivStrategy({
				sourceName: 'arxiv',
				windowStart: new Date('2024-01-01T00:00:00Z'),
				windowEnd: new Date('2024-02-01T00:00:00Z'),
				backfillRunId: 'run-123'
			});

			assert.equal(result.items.length, 2, 'two in-window items');
			for (const item of result.items) {
				assert.equal(item.sourceOrigin, 'direct_archive');
				assert.equal(item.backfillRunId, 'run-123');
				assert.equal(item.sourcePlatform, 'arxiv');
				assert.equal(item.sourceName, 'arXiv:cs.AI');
				assert.ok(item.publishedAt instanceof Date);
				assert.ok(item.url.startsWith('https://arxiv.org/abs/'));
			}
		});

		it('drops entries published outside the window without erroring', async () => {
			const xml = await readFile(FIXTURE_PATH, 'utf8');
			fetchQueue.push(() => xmlResponse(xml));

			const result = await arxivStrategy({
				sourceName: 'arxiv',
				windowStart: new Date('2024-01-01T00:00:00Z'),
				windowEnd: new Date('2024-02-01T00:00:00Z'),
				backfillRunId: 'run-1'
			});

			assert.equal(
				result.items.find((i) => i.title === 'Out Of Window Paper'),
				undefined
			);
		});
	});

	describe('error handling', () => {
		it('records non-fatal errors and continues for other categories', async () => {
			fetchQueue.push(() => new Response('boom', { status: 500 }));

			const result = await arxivStrategy({
				sourceName: 'arxiv',
				windowStart: new Date('2024-01-01T00:00:00Z'),
				windowEnd: new Date('2024-02-01T00:00:00Z'),
				backfillRunId: 'run-1'
			});

			assert.equal(result.items.length, 0);
			assert.equal(result.errors.length, 1);
			assert.match(result.errors[0], /HTTP 500/);
		});

		it('honors AbortSignal between pages', async () => {
			const controller = new AbortController();
			controller.abort();

			const result = await arxivStrategy({
				sourceName: 'arxiv',
				windowStart: new Date('2024-01-01T00:00:00Z'),
				windowEnd: new Date('2024-02-01T00:00:00Z'),
				backfillRunId: 'run-1',
				signal: controller.signal
			});

			assert.equal(fetchCalls.length, 0);
			assert.equal(result.items.length, 0);
		});
	});
});
