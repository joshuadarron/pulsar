import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
	articleCountsBySource,
	claimJobs,
	completeJob,
	enqueueBackfill,
	failJob
} from '../queue.js';

type Recorded = { sql: string; params: unknown[] };

type FakeRow = Record<string, unknown>;

type QueryHandler = (sql: string, params: unknown[]) => { rows: FakeRow[]; rowCount: number };

function makeExecutor(handler: QueryHandler) {
	const calls: Recorded[] = [];
	const executor = {
		query: async <T = unknown>(sql: string, params: unknown[] = []) => {
			calls.push({ sql, params });
			const out = handler(sql, params);
			return { rows: out.rows as unknown as T[], rowCount: out.rowCount as number | null };
		}
	};
	return { executor, calls };
}

describe('claimJobs', () => {
	it('returns at most `limit` jobs from a single call', async () => {
		const queueLength = 10;
		const limit = 3;
		const handler: QueryHandler = (_sql, params) => {
			const lim = Number(params[1]);
			const rows = Array.from({ length: Math.min(lim, queueLength) }, (_, i) => ({
				id: `job-${i}`,
				backfill_run_id: `run-${i}`,
				source_name: 'hackernews',
				window_start: new Date('2024-01-01T00:00:00Z'),
				window_end: new Date('2024-01-02T00:00:00Z'),
				strategy: 'wayback',
				status: 'claimed',
				attempts: 1,
				claimed_by: params[0],
				claimed_at: new Date(),
				completed_at: null,
				error_message: null,
				created_at: new Date()
			}));
			return { rows, rowCount: rows.length };
		};
		const { executor, calls } = makeExecutor(handler);

		const claimed = await claimJobs(executor, 'worker-1', limit);
		assert.equal(claimed.length, limit);
		assert.equal(calls.length, 1);
		assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
		assert.equal(calls[0].params[0], 'worker-1');
		assert.equal(calls[0].params[1], limit);
		// Field mapping: snake_case row -> camelCase domain object.
		assert.equal(claimed[0].sourceName, 'hackernews');
		assert.equal(claimed[0].claimedBy, 'worker-1');
		assert.equal(claimed[0].backfillRunId, 'run-0');
	});

	it('two concurrent claim calls do not return overlapping job IDs', async () => {
		// Simulate FOR UPDATE SKIP LOCKED at the application level: each call
		// drains from a shared queue; the DB is responsible for ensuring a
		// single row is never returned twice. Here we model that contract.
		const queue: string[] = ['j1', 'j2', 'j3', 'j4', 'j5'];
		const handler: QueryHandler = (_sql, params) => {
			const lim = Number(params[1]);
			const taken = queue.splice(0, lim);
			const rows = taken.map((id) => ({
				id,
				backfill_run_id: null,
				source_name: 'reddit',
				window_start: new Date(),
				window_end: new Date(),
				strategy: 'cdx',
				status: 'claimed',
				attempts: 1,
				claimed_by: params[0],
				claimed_at: new Date(),
				completed_at: null,
				error_message: null,
				created_at: new Date()
			}));
			return { rows, rowCount: rows.length };
		};
		const { executor } = makeExecutor(handler);

		const [a, b] = await Promise.all([
			claimJobs(executor, 'worker-a', 2),
			claimJobs(executor, 'worker-b', 2)
		]);
		const ids = new Set<string>();
		for (const j of [...a, ...b]) {
			assert.ok(!ids.has(j.id), `duplicate claim: ${j.id}`);
			ids.add(j.id);
		}
		assert.equal(ids.size, 4);
	});
});

describe('completeJob', () => {
	it('marks the job complete and increments the run ingested count', async () => {
		const handler: QueryHandler = () => ({ rows: [], rowCount: 1 });
		const { executor, calls } = makeExecutor(handler);

		await completeJob(executor, 'job-1', 42);
		assert.equal(calls.length, 2);
		assert.match(calls[0].sql, /UPDATE backfill_jobs/);
		assert.match(calls[0].sql, /status = 'complete'/);
		assert.equal(calls[0].params[0], 'job-1');
		assert.match(calls[1].sql, /UPDATE backfill_runs/);
		assert.match(calls[1].sql, /articles_ingested = articles_ingested \+ \$2/);
		assert.equal(calls[1].params[1], 42);
	});
});

describe('failJob', () => {
	it('marks the job failed with the error message and records the run error', async () => {
		const handler: QueryHandler = () => ({ rows: [], rowCount: 1 });
		const { executor, calls } = makeExecutor(handler);

		await failJob(executor, 'job-9', new Error('cdx fetch timeout'));
		assert.equal(calls.length, 2);
		assert.match(calls[0].sql, /status = 'failed'/);
		assert.equal(calls[0].params[0], 'job-9');
		assert.equal(calls[0].params[1], 'cdx fetch timeout');
		assert.match(calls[1].sql, /UPDATE backfill_runs/);
	});

	it('does not mutate the attempts counter on failure (claim already incremented it)', async () => {
		const handler: QueryHandler = () => ({ rows: [], rowCount: 1 });
		const { executor, calls } = makeExecutor(handler);

		await failJob(executor, 'job-9', new Error('boom'));
		const failSql = calls[0].sql;
		assert.equal(/attempts\s*=/.test(failSql), false);
	});
});

describe('enqueueBackfill', () => {
	it('inserts a backfill_runs row and a backfill_jobs row and returns both IDs', async () => {
		const handler: QueryHandler = (sql) => {
			if (/INSERT INTO backfill_runs/.test(sql)) {
				return { rows: [{ id: 'run-xyz' }], rowCount: 1 };
			}
			if (/INSERT INTO backfill_jobs/.test(sql)) {
				return { rows: [{ id: 'job-abc' }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		};
		const { executor, calls } = makeExecutor(handler);

		const out = await enqueueBackfill(
			executor,
			'arxiv',
			new Date('2022-12-01T00:00:00Z'),
			new Date('2022-12-08T00:00:00Z'),
			'direct_archive'
		);
		assert.equal(out.runId, 'run-xyz');
		assert.equal(out.jobId, 'job-abc');
		assert.equal(calls.length, 2);
		assert.equal(calls[0].params[0], 'arxiv');
		assert.equal(calls[1].params[0], 'run-xyz');
		assert.equal(calls[1].params[4], 'direct_archive');
	});
});

describe('articleCountsBySource', () => {
	it('returns a record keyed by source_name with integer counts', async () => {
		const handler: QueryHandler = () => ({
			rows: [
				{ source_name: 'hackernews', count: '120' },
				{ source_name: 'reddit', count: '5' }
			],
			rowCount: 2
		});
		const { executor } = makeExecutor(handler);

		const counts = await articleCountsBySource(executor);
		assert.deepEqual(counts, { hackernews: 120, reddit: 5 });
	});
});

describe('claimJobs (mock.fn integration)', () => {
	it('uses parameterized queries (no string interpolation of workerId)', async () => {
		const queryFn = mock.fn(async (_sql: string, _params: unknown[]) => ({
			rows: [],
			rowCount: 0
		}));
		const executor = { query: queryFn } as unknown as Parameters<typeof claimJobs>[0];
		await claimJobs(executor, 'worker-x', 5);
		const call = queryFn.mock.calls[0];
		const sql = call.arguments[0];
		assert.equal(sql.includes('worker-x'), false, 'workerId must be parameterized');
		const params = call.arguments[1];
		assert.deepEqual(params, ['worker-x', 5]);
	});
});
