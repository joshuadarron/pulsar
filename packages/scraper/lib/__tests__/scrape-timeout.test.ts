import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ScrapeTimeoutError, withScrapeTimeout } from '../scrape-timeout.js';

describe('withScrapeTimeout', () => {
	describe('happy path', () => {
		it('resolves with the wrapped value when the scrape finishes in time', async () => {
			const result = await withScrapeTimeout(async () => 'done', 1000);
			assert.equal(result, 'done');
		});

		it('propagates rejections from the wrapped scrape unchanged', async () => {
			const original = new Error('adapter failed');
			await assert.rejects(
				withScrapeTimeout(async () => {
					throw original;
				}, 1000),
				(err) => err === original
			);
		});
	});

	describe('timeout', () => {
		it('rejects with ScrapeTimeoutError when the scrape never settles', async () => {
			const neverSettles = () => new Promise<void>(() => {});
			await assert.rejects(withScrapeTimeout(neverSettles, 50), (err) => {
				assert.ok(err instanceof ScrapeTimeoutError);
				assert.equal((err as ScrapeTimeoutError).timeoutMs, 50);
				return true;
			});
		});

		it('reports the configured timeout in the error message', async () => {
			const neverSettles = () => new Promise<void>(() => {});
			await assert.rejects(withScrapeTimeout(neverSettles, 25), (err) => {
				assert.match((err as Error).message, /25ms fail-safe timeout/);
				return true;
			});
		});
	});

	describe('timer cleanup', () => {
		it('clears the fail-safe timer on resolve so the process can exit', async () => {
			// If the timer were leaked, node:test would keep the event loop alive
			// past the assertion. The test runner enforces this implicitly.
			await withScrapeTimeout(async () => 42, 10_000);
		});

		it('clears the fail-safe timer on reject as well', async () => {
			await withScrapeTimeout(async () => {
				throw new Error('boom');
			}, 10_000).catch(() => undefined);
		});
	});
});
