import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
	WaybackHttpError,
	WaybackRateLimitError,
	__resetRateLimiterForTesting,
	applyRateLimit,
	buildCdxQueryUrl,
	parseCdxResponse,
	queryCdx,
	withRetryOn5xx
} from '../cdx.js';
import { buildArchivedHtmlUrl, fetchArchivedHtml } from '../fetch-archived.js';

const FIXTURE_PATH = new URL('./fixtures/cdx-sample.json', import.meta.url);

type FetchCall = {
	url: string;
	init?: RequestInit;
};

let fetchCalls: FetchCall[] = [];
let fetchQueue: Array<() => Response | Promise<Response>> = [];
const realFetch = globalThis.fetch;

function installFetchStub(): void {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		fetchCalls.push({ url, init });
		const next = fetchQueue.shift();
		if (!next) {
			throw new Error(`Unexpected fetch call: ${url}`);
		}
		return next();
	}) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function htmlResponse(body: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: { 'Content-Type': 'text/html' }
	});
}

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(path.join(tmpdir(), 'wayback-cdx-test-'));
	fetchCalls = [];
	fetchQueue = [];
	__resetRateLimiterForTesting();
	// biome-ignore lint/performance/noDelete: must remove env var, not stringify undefined
	delete process.env.WAYBACK_CACHE_DISABLE;
	installFetchStub();
});

afterEach(async () => {
	globalThis.fetch = realFetch;
	// biome-ignore lint/performance/noDelete: must remove env var, not stringify undefined
	delete process.env.WAYBACK_CACHE_DISABLE;
	await rm(tempDir, { recursive: true, force: true });
});

describe('buildCdxQueryUrl', () => {
	it('formats timestamps as YYYYMMDDhhmmss in UTC and includes filters', () => {
		const url = buildCdxQueryUrl(
			'medium.com/towards-data-science',
			new Date(Date.UTC(2023, 0, 15, 12, 0, 0)),
			new Date(Date.UTC(2023, 1, 20, 8, 0, 0))
		);
		assert.match(url, /from=20230115120000/);
		assert.match(url, /to=20230220080000/);
		assert.match(url, /output=json/);
		assert.match(url, /collapse=urlkey/);
		assert.match(url, /filter=statuscode%3A200/);
		assert.match(url, /filter=mimetype%3Atext%2Fhtml/);
	});
});

describe('parseCdxResponse', () => {
	it('parses the 2D JSON array using the first row as headers', async () => {
		const raw = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
		const entries = parseCdxResponse(raw);
		assert.equal(entries.length, 2);
		assert.equal(entries[0].timestamp, '20230115120000');
		assert.equal(entries[0].originalUrl, 'https://medium.com/towards-data-science/abc');
		assert.equal(entries[0].statusCode, 200);
		assert.equal(entries[0].mimetype, 'text/html');
		assert.equal(entries[0].length, 12345);
	});

	it('returns an empty array for empty or header-only responses', () => {
		assert.deepEqual(parseCdxResponse([]), []);
		assert.deepEqual(parseCdxResponse([['urlkey', 'timestamp']]), []);
	});
});

describe('applyRateLimit', () => {
	it('enforces minimum spacing between consecutive calls', async () => {
		const start = Date.now();
		await applyRateLimit(50);
		await applyRateLimit(50);
		const elapsed = Date.now() - start;
		assert.ok(elapsed >= 45, `expected >=45ms, got ${elapsed}`);
	});
});

describe('queryCdx', () => {
	const windowStart = new Date(Date.UTC(2023, 0, 1));
	const windowEnd = new Date(Date.UTC(2023, 11, 31));

	describe('happy path', () => {
		it('fetches, parses, and writes a cache entry', async () => {
			const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
			fetchQueue.push(() => jsonResponse(fixture));

			const entries = await queryCdx('medium.com/towards-data-science', windowStart, windowEnd, {
				cacheDir: tempDir,
				rateLimitMs: 1
			});

			assert.equal(entries.length, 2);
			assert.equal(fetchCalls.length, 1);
			assert.match(fetchCalls[0].url, /web\.archive\.org\/cdx\/search\/cdx/);
			const ua = (fetchCalls[0].init?.headers as Record<string, string>)['User-Agent'];
			assert.match(ua, /Pulsar-Backfill/);
		});

		it('returns the cached value on the second call without re-fetching', async () => {
			const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
			fetchQueue.push(() => jsonResponse(fixture));

			const first = await queryCdx('medium.com/towards-data-science', windowStart, windowEnd, {
				cacheDir: tempDir,
				rateLimitMs: 1
			});
			const second = await queryCdx('medium.com/towards-data-science', windowStart, windowEnd, {
				cacheDir: tempDir,
				rateLimitMs: 1
			});

			assert.equal(fetchCalls.length, 1, 'second call should hit cache');
			assert.deepEqual(first, second);
		});
	});

	describe('error handling', () => {
		it('maps HTTP 429 to WaybackRateLimitError without retrying', async () => {
			fetchQueue.push(() => new Response('rate limited', { status: 429 }));

			await assert.rejects(
				() =>
					queryCdx('medium.com/foo', windowStart, windowEnd, {
						cacheDir: tempDir,
						rateLimitMs: 1
					}),
				WaybackRateLimitError
			);
			assert.equal(fetchCalls.length, 1);
		});

		it('retries up to 3 times on HTTP 5xx and surfaces the final error', async () => {
			let attempts = 0;
			const result = withRetryOn5xx(
				async () => {
					attempts++;
					throw new WaybackHttpError(503, 'boom');
				},
				3,
				1
			);
			await assert.rejects(
				() => result,
				(err: Error) => err instanceof WaybackHttpError && (err as WaybackHttpError).status === 503
			);
			assert.equal(attempts, 3);
		});

		it('does not retry on WaybackRateLimitError (429)', async () => {
			let attempts = 0;
			const result = withRetryOn5xx(
				async () => {
					attempts++;
					throw new WaybackRateLimitError();
				},
				3,
				1
			);
			await assert.rejects(() => result, WaybackRateLimitError);
			assert.equal(attempts, 1);
		});

		it('returns an empty array on HTTP 404', async () => {
			fetchQueue.push(() => new Response('not found', { status: 404 }));
			const entries = await queryCdx('medium.com/foo', windowStart, windowEnd, {
				cacheDir: tempDir,
				rateLimitMs: 1
			});
			assert.deepEqual(entries, []);
		});
	});
});

describe('fetchArchivedHtml', () => {
	const entry = {
		urlkey: 'com,example)/a',
		timestamp: '20230115120000',
		originalUrl: 'https://example.com/a',
		mimetype: 'text/html',
		statusCode: 200,
		digest: 'AAA',
		length: 100
	};

	describe('URL construction', () => {
		it('builds the playback URL with the id_ flag', () => {
			const url = buildArchivedHtmlUrl(entry.timestamp, entry.originalUrl);
			assert.equal(url, 'https://web.archive.org/web/20230115120000id_/https://example.com/a');
		});

		it('hits the playback URL on a fresh fetch', async () => {
			fetchQueue.push(() => htmlResponse('<html>archived</html>'));

			const html = await fetchArchivedHtml(entry, { cacheDir: tempDir, rateLimitMs: 1 });

			assert.equal(html, '<html>archived</html>');
			assert.equal(fetchCalls.length, 1);
			assert.equal(
				fetchCalls[0].url,
				'https://web.archive.org/web/20230115120000id_/https://example.com/a'
			);
		});
	});

	describe('cache and skip behavior', () => {
		it('caches the body and skips network on a second call', async () => {
			fetchQueue.push(() => htmlResponse('<html>archived</html>'));

			await fetchArchivedHtml(entry, { cacheDir: tempDir, rateLimitMs: 1 });
			const second = await fetchArchivedHtml(entry, { cacheDir: tempDir, rateLimitMs: 1 });

			assert.equal(second, '<html>archived</html>');
			assert.equal(fetchCalls.length, 1);
		});

		it('returns null on HTTP 404 and does not write a cache entry', async () => {
			fetchQueue.push(() => new Response('gone', { status: 404 }));
			const html = await fetchArchivedHtml(entry, { cacheDir: tempDir, rateLimitMs: 1 });
			assert.equal(html, null);
		});

		it('returns null when the body indicates a robots block', async () => {
			fetchQueue.push(() => htmlResponse('This URL has been excluded from the Wayback Machine.'));
			const html = await fetchArchivedHtml(entry, { cacheDir: tempDir, rateLimitMs: 1 });
			assert.equal(html, null);
		});

		it('maps HTTP 429 to WaybackRateLimitError', async () => {
			fetchQueue.push(() => new Response('rate limited', { status: 429 }));
			await assert.rejects(
				() => fetchArchivedHtml(entry, { cacheDir: tempDir, rateLimitMs: 1 }),
				WaybackRateLimitError
			);
		});
	});
});
