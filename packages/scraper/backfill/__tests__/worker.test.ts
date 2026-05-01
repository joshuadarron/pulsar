import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import type { ScrapedItem } from '@pulsar/shared/types';

import type { ClaimedJob } from '../queue.js';
import type { Strategy } from '../strategies/types.js';

// Capture inserted-items calls from the worker.
const insertCalls: Array<{
	items: ScrapedItem[];
	backfillRunId: string;
}> = [];
mock.module('../insert.js', {
	namedExports: {
		insertBackfilledItems: async (
			_executor: unknown,
			items: ScrapedItem[],
			backfillRunId: string
		) => {
			insertCalls.push({ items, backfillRunId });
			return items.length;
		}
	}
});

// Stub the strategy registry. The map is mutated per-test via `setStrategy`.
const strategyMap = new Map<string, Strategy>();
mock.module('../strategies/index.js', {
	namedExports: {
		getStrategy: (sourceName: string): Strategy => {
			const s = strategyMap.get(sourceName);
			if (!s) throw new Error(`no strategy for ${sourceName}`);
			return s;
		}
	}
});

const completedJobs: Array<{ id: string; count: number }> = [];
const failedJobs: Array<{ id: string; message: string }> = [];
let claimQueue: ClaimedJob[][] = [];
let claimCallCount = 0;

mock.module('../queue.js', {
	namedExports: {
		claimJobs: async () => {
			claimCallCount += 1;
			return claimQueue.shift() ?? [];
		},
		completeJob: async (_executor: unknown, jobId: string, count: number) => {
			completedJobs.push({ id: jobId, count });
		},
		failJob: async (_executor: unknown, jobId: string, error: Error) => {
			failedJobs.push({ id: jobId, message: error.message });
		}
	}
});

const { workerLoop } = await import('../worker.js');

function buildJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
	return {
		id: 'job-1',
		backfillRunId: 'run-1',
		sourceName: 'arxiv',
		windowStart: new Date('2024-01-01T00:00:00Z'),
		windowEnd: new Date('2024-01-02T00:00:00Z'),
		strategy: 'manual',
		status: 'claimed',
		attempts: 1,
		claimedBy: 'worker-1',
		claimedAt: new Date(),
		completedAt: null,
		errorMessage: null,
		createdAt: new Date(),
		...overrides
	};
}

function reset() {
	insertCalls.length = 0;
	completedJobs.length = 0;
	failedJobs.length = 0;
	claimQueue = [];
	strategyMap.clear();
	claimCallCount = 0;
}

const fakeExecutor = {
	query: async () => ({ rows: [] as unknown[], rowCount: 0 })
};

describe('workerLoop', () => {
	it('claims a job, runs the strategy, inserts, and marks complete', async () => {
		reset();
		const job = buildJob({ id: 'j-ok' });
		claimQueue = [[job]];
		strategyMap.set('arxiv', async () => ({
			items: [
				{
					url: 'https://arxiv.org/abs/2401.0001',
					title: 't',
					rawContent: 'r',
					publishedAt: new Date('2024-01-01T00:00:00Z'),
					sourceName: 'arxiv',
					sourcePlatform: 'arxiv',
					sourceOrigin: 'direct_archive'
				}
			],
			errors: []
		}));

		const controller = new AbortController();
		const loop = workerLoop({
			workerId: 'test',
			concurrency: 1,
			pollIntervalMs: 5,
			abortSignal: controller.signal,
			executor: fakeExecutor as never
		});
		// Allow one tick to process the queued job, then abort.
		await new Promise((r) => setTimeout(r, 30));
		controller.abort();
		await loop;

		assert.equal(insertCalls.length, 1);
		assert.equal(insertCalls[0].items.length, 1);
		assert.equal(insertCalls[0].backfillRunId, 'run-1');
		assert.deepEqual(completedJobs, [{ id: 'j-ok', count: 1 }]);
		assert.deepEqual(failedJobs, []);
	});

	it('marks the job failed when the strategy throws', async () => {
		reset();
		const job = buildJob({ id: 'j-bad', sourceName: 'arxiv' });
		claimQueue = [[job]];
		strategyMap.set('arxiv', async () => {
			throw new Error('cdx fetch timeout');
		});

		const controller = new AbortController();
		const loop = workerLoop({
			workerId: 'test',
			concurrency: 1,
			pollIntervalMs: 5,
			abortSignal: controller.signal,
			executor: fakeExecutor as never
		});
		await new Promise((r) => setTimeout(r, 30));
		controller.abort();
		await loop;

		assert.deepEqual(failedJobs, [{ id: 'j-bad', message: 'cdx fetch timeout' }]);
		assert.deepEqual(completedJobs, []);
	});

	it('marks the job failed when no strategy is registered (does not crash)', async () => {
		reset();
		const job = buildJob({ id: 'j-nope', sourceName: 'unknown-source' });
		claimQueue = [[job]];

		const controller = new AbortController();
		const loop = workerLoop({
			workerId: 'test',
			concurrency: 1,
			pollIntervalMs: 5,
			abortSignal: controller.signal,
			executor: fakeExecutor as never
		});
		await new Promise((r) => setTimeout(r, 30));
		controller.abort();
		await loop;

		assert.equal(failedJobs.length, 1);
		assert.equal(failedJobs[0].id, 'j-nope');
		assert.match(failedJobs[0].message, /no strategy for unknown-source/);
	});

	it('exits cleanly when abortSignal is aborted while idle', async () => {
		reset();
		// claimQueue stays empty; the loop should poll and exit on abort.
		const controller = new AbortController();
		const start = Date.now();
		const loop = workerLoop({
			workerId: 'test',
			concurrency: 2,
			pollIntervalMs: 10,
			abortSignal: controller.signal,
			executor: fakeExecutor as never
		});
		setTimeout(() => controller.abort(), 25);
		await loop;
		assert.ok(Date.now() - start < 200, 'loop should exit promptly on abort');
		assert.ok(claimCallCount >= 1, 'loop should have polled at least once');
	});

	it('processes multiple jobs in one tick (concurrency)', async () => {
		reset();
		const jobs = [buildJob({ id: 'a' }), buildJob({ id: 'b' })];
		claimQueue = [jobs];
		strategyMap.set('arxiv', async () => ({ items: [], errors: [] }));

		const controller = new AbortController();
		const loop = workerLoop({
			workerId: 'test',
			concurrency: 2,
			pollIntervalMs: 5,
			abortSignal: controller.signal,
			executor: fakeExecutor as never
		});
		await new Promise((r) => setTimeout(r, 30));
		controller.abort();
		await loop;

		const completedIds = completedJobs.map((j) => j.id).sort();
		assert.deepEqual(completedIds, ['a', 'b']);
	});
});
