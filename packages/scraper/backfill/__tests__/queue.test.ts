import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
	COVERAGE_WINDOW_START,
	MAX_JOB_ATTEMPTS,
	MAX_MONTH_ATTEMPTS,
	MONTH_COVERAGE_THRESHOLD,
	MONTH_RETRY_COOLDOWN_DAYS,
	articleCountsByAdapter,
	claimJobs,
	completeJob,
	enqueueBackfill,
	failJob,
	inflightCount,
	monthAttemptCount,
	monthAttemptedRecently,
	monthsMissingCoverage,
	requeueRetriableFailures
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
		// No diagnostics → the runs UPDATE must not append to errors.
		assert.equal(/errors\s*=/.test(calls[1].sql), false);
	});

	it('persists strategy errors and warnings into backfill_runs.errors on success', async () => {
		const handler: QueryHandler = () => ({ rows: [], rowCount: 1 });
		const { executor, calls } = makeExecutor(handler);

		await completeJob(executor, 'job-2', 0, {
			errors: ['parse failed for X'],
			warnings: ['feed Y: snapshots=10 keptInWindow=0']
		});
		assert.equal(calls.length, 2);
		const runUpdate = calls[1];
		assert.match(runUpdate.sql, /UPDATE backfill_runs/);
		assert.match(runUpdate.sql, /errors = COALESCE\(errors, '\[\]'::jsonb\) \|\| \$3::jsonb/);
		const payload = JSON.parse(String(runUpdate.params[2]));
		assert.equal(payload.length, 2);
		assert.equal(payload[0].severity, 'error');
		assert.equal(payload[0].message, 'parse failed for X');
		assert.equal(payload[1].severity, 'warning');
		assert.equal(payload[1].message, 'feed Y: snapshots=10 keptInWindow=0');
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

describe('monthsMissingCoverage', () => {
	it('returns months from the SQL result in newest-first order', async () => {
		const handler: QueryHandler = () => ({
			rows: [
				{ month_start: new Date('2025-12-01T00:00:00Z') },
				{ month_start: new Date('2025-06-01T00:00:00Z') },
				{ month_start: new Date('2024-01-01T00:00:00Z') }
			],
			rowCount: 3
		});
		const { executor } = makeExecutor(handler);
		const months = await monthsMissingCoverage(executor, 'devto');
		assert.equal(months.length, 3);
		assert.equal(months[0].toISOString(), '2025-12-01T00:00:00.000Z');
	});

	it('parameterizes coverage window, platforms list, and threshold', async () => {
		let capturedParams: unknown[] | null = null;
		const handler: QueryHandler = (_sql, params) => {
			capturedParams = params;
			return { rows: [], rowCount: 0 };
		};
		const { executor } = makeExecutor(handler);
		await monthsMissingCoverage(executor, 'rss', 7);
		assert.equal((capturedParams![0] as Date).getTime(), COVERAGE_WINDOW_START.getTime());
		// 'rss' adapter fans out to ['rss', 'substack'] in BACKFILL_PLATFORMS.
		assert.deepEqual(capturedParams![1], ['rss', 'substack']);
		assert.equal(capturedParams![2], 7);
	});

	it('returns an empty array for an unknown adapter', async () => {
		const handler: QueryHandler = () => ({ rows: [{ month_start: new Date() }], rowCount: 1 });
		const { executor, calls } = makeExecutor(handler);
		const months = await monthsMissingCoverage(executor, 'no-such-adapter');
		assert.deepEqual(months, []);
		assert.equal(calls.length, 0, 'unknown adapter should short-circuit before the SQL call');
	});

	it('uses the default threshold when not supplied', async () => {
		let capturedThreshold: unknown = null;
		const handler: QueryHandler = (_sql, params) => {
			capturedThreshold = params[2];
			return { rows: [], rowCount: 0 };
		};
		const { executor } = makeExecutor(handler);
		await monthsMissingCoverage(executor, 'github');
		assert.equal(capturedThreshold, MONTH_COVERAGE_THRESHOLD);
	});
});

describe('inflightCount', () => {
	it('counts month-fill jobs in queued or claimed state for the adapter', async () => {
		let capturedSql: string | null = null;
		let capturedParams: unknown[] | null = null;
		const handler: QueryHandler = (sql, params) => {
			capturedSql = sql;
			capturedParams = params;
			return { rows: [{ count: '2' }], rowCount: 1 };
		};
		const { executor } = makeExecutor(handler);
		const count = await inflightCount(executor, 'devto');
		assert.equal(count, 2);
		assert.match(capturedSql!, /SELECT COUNT\(\*\)/);
		assert.match(capturedSql!, /strategy = 'month-fill'/);
		assert.match(capturedSql!, /status IN \('queued', 'claimed'\)/);
		assert.equal(capturedParams![0], 'devto');
	});

	it('returns 0 when the query returns no rows', async () => {
		const handler: QueryHandler = () => ({ rows: [], rowCount: 0 });
		const { executor } = makeExecutor(handler);
		const count = await inflightCount(executor, 'devto');
		assert.equal(count, 0);
	});
});

describe('monthAttemptCount', () => {
	it('returns the COUNT of backfill_runs rows for (source, window_start)', async () => {
		let capturedSql: string | null = null;
		let capturedParams: unknown[] | null = null;
		const handler: QueryHandler = (sql, params) => {
			capturedSql = sql;
			capturedParams = params;
			return { rows: [{ count: '2' }], rowCount: 1 };
		};
		const { executor } = makeExecutor(handler);
		const month = new Date('2024-01-01T00:00:00Z');
		const count = await monthAttemptCount(executor, 'hashnode', month);
		assert.equal(count, 2);
		assert.match(capturedSql!, /SELECT COUNT\(\*\).*backfill_runs/);
		assert.equal(capturedParams![0], 'hashnode');
		assert.equal((capturedParams![1] as Date).getTime(), month.getTime());
	});

	it('returns 0 when no rows match', async () => {
		const handler: QueryHandler = () => ({ rows: [], rowCount: 0 });
		const { executor } = makeExecutor(handler);
		const count = await monthAttemptCount(executor, 'hashnode', new Date());
		assert.equal(count, 0);
	});

	it('MAX_MONTH_ATTEMPTS is at least 2 so first attempt + 1 retry is allowed', () => {
		assert.ok(MAX_MONTH_ATTEMPTS >= 2, 'cap below 2 would block legitimate retries');
	});
});

describe('monthAttemptedRecently', () => {
	it('returns true when a backfill_runs row exists in the cooldown window', async () => {
		const handler: QueryHandler = () => ({ rows: [{ id: 'r1' }], rowCount: 1 });
		const { executor } = makeExecutor(handler);
		const recent = await monthAttemptedRecently(executor, 'rss', new Date('2024-01-01T00:00:00Z'));
		assert.equal(recent, true);
	});

	it('returns false when no row matches', async () => {
		const handler: QueryHandler = () => ({ rows: [], rowCount: 0 });
		const { executor } = makeExecutor(handler);
		const recent = await monthAttemptedRecently(executor, 'rss', new Date('2024-01-01T00:00:00Z'));
		assert.equal(recent, false);
	});

	it('passes the cooldown days through as the third parameter', async () => {
		let capturedParams: unknown[] | null = null;
		const handler: QueryHandler = (_sql, params) => {
			capturedParams = params;
			return { rows: [], rowCount: 0 };
		};
		const { executor } = makeExecutor(handler);
		await monthAttemptedRecently(executor, 'rss', new Date('2024-01-01T00:00:00Z'), 14);
		assert.equal(capturedParams![0], 'rss');
		assert.equal(capturedParams![2], '14');
	});

	it('uses the default cooldown when not supplied', async () => {
		let capturedParams: unknown[] | null = null;
		const handler: QueryHandler = (_sql, params) => {
			capturedParams = params;
			return { rows: [], rowCount: 0 };
		};
		const { executor } = makeExecutor(handler);
		await monthAttemptedRecently(executor, 'rss', new Date('2024-01-01T00:00:00Z'));
		assert.equal(capturedParams![2], String(MONTH_RETRY_COOLDOWN_DAYS));
	});
});

describe('requeueRetriableFailures', () => {
	it('promotes failed jobs with attempts below the cap back to queued', async () => {
		let capturedSql: string | null = null;
		let capturedParams: unknown[] | null = null;
		const handler: QueryHandler = (sql, params) => {
			capturedSql = sql;
			capturedParams = params;
			return { rows: [], rowCount: 4 };
		};
		const { executor } = makeExecutor(handler);

		const promoted = await requeueRetriableFailures(executor);
		assert.equal(promoted, 4);
		assert.match(capturedSql!, /UPDATE backfill_jobs/);
		assert.match(capturedSql!, /status = 'queued'/);
		assert.match(capturedSql!, /status = 'failed' AND attempts < \$1/);
		assert.equal(capturedParams![0], MAX_JOB_ATTEMPTS);
	});

	it('clears claimed_by, claimed_at, completed_at, and error_message so the row reads as fresh', async () => {
		const handler: QueryHandler = () => ({ rows: [], rowCount: 0 });
		const { executor, calls } = makeExecutor(handler);
		await requeueRetriableFailures(executor);
		const sql = calls[0].sql;
		assert.match(sql, /claimed_by = NULL/);
		assert.match(sql, /claimed_at = NULL/);
		assert.match(sql, /completed_at = NULL/);
		assert.match(sql, /error_message = NULL/);
	});

	it('preserves the attempts counter so retries are bounded over time', async () => {
		const handler: QueryHandler = () => ({ rows: [], rowCount: 0 });
		const { executor, calls } = makeExecutor(handler);
		await requeueRetriableFailures(executor);
		assert.equal(/attempts\s*=/.test(calls[0].sql), false);
	});

	it('respects a caller-supplied maxAttempts override', async () => {
		const handler: QueryHandler = () => ({ rows: [], rowCount: 0 });
		const { executor, calls } = makeExecutor(handler);
		await requeueRetriableFailures(executor, 5);
		assert.equal(calls[0].params[0], 5);
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

describe('articleCountsByAdapter', () => {
	it('groups live counts by sourcePlatform and maps them back to adapter keys', async () => {
		let capturedParams: unknown[] | null = null;
		const handler: QueryHandler = (_sql, params) => {
			capturedParams = params;
			return {
				rows: [
					{ platform: 'hackernews', count: '120' },
					{ platform: 'reddit', count: '5' }
				],
				rowCount: 2
			};
		};
		const { executor } = makeExecutor(handler);

		const counts = await articleCountsByAdapter(executor);
		assert.equal(counts.hackernews, 120);
		assert.equal(counts.reddit, 5);
		// Adapter keys with no rows still show up with count 0 so the auto-enqueue
		// sparse check fires for never-scraped adapters.
		assert.equal(counts.arxiv, 0);
		assert.equal(counts.devto, 0);
		// Query was parameterized with the union of all known platforms.
		const platforms = capturedParams![0] as string[];
		assert.ok(platforms.includes('substack'), "'rss' adapter fans out to substack");
		assert.ok(platforms.includes('rss'));
	});

	it('sums counts when one adapter maps to multiple platforms (rss -> rss + substack)', async () => {
		const handler: QueryHandler = () => ({
			rows: [
				{ platform: 'rss', count: '10' },
				{ platform: 'substack', count: '7' }
			],
			rowCount: 2
		});
		const { executor } = makeExecutor(handler);
		const counts = await articleCountsByAdapter(executor);
		assert.equal(counts.rss, 17);
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
