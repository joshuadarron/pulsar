import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { withRetry } from '../retry.js';

describe('withRetry', () => {
	describe('success path', () => {
		it('returns the value on first success without retrying', async () => {
			const fn = mock.fn(async () => 'ok');
			const result = await withRetry(fn, 3, 1);
			assert.equal(result, 'ok');
			assert.equal(fn.mock.callCount(), 1);
		});

		it('retries on rejection and resolves on a later attempt', async () => {
			let calls = 0;
			const fn = mock.fn(async () => {
				calls++;
				if (calls < 2) throw new Error('transient');
				return 'recovered';
			});
			const result = await withRetry(fn, 3, 1);
			assert.equal(result, 'recovered');
			assert.equal(fn.mock.callCount(), 2);
		});
	});

	describe('failure path', () => {
		it('throws the last error after maxAttempts is exhausted', async () => {
			const errors = [new Error('fail-1'), new Error('fail-2'), new Error('fail-3')];
			let i = 0;
			const fn = mock.fn(async () => {
				throw errors[i++];
			});
			await assert.rejects(() => withRetry(fn, 3, 1), errors[2]);
			assert.equal(fn.mock.callCount(), 3);
		});

		it('does not retry when maxAttempts is 1', async () => {
			const err = new Error('boom');
			const fn = mock.fn(async () => {
				throw err;
			});
			await assert.rejects(() => withRetry(fn, 1, 1), err);
			assert.equal(fn.mock.callCount(), 1);
		});
	});
});
