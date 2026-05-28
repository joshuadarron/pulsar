import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

mock.module('@pulsar/shared/config/env', {
	namedExports: {
		env: {
			backfill: {
				enabled: true,
				enableCommonCrawl: false,
				workerConcurrency: 2
			}
		}
	}
});

const { maybeAutoEnqueue, FIRST_DEPLOY_THRESHOLD, FIRST_DEPLOY_FROM } = await import(
	'../auto-enqueue.js'
);
const envModule = (await import('@pulsar/shared/config/env')) as unknown as {
	env: { backfill: { enabled: boolean } };
};

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

// Seed all known backfill adapters above the threshold; tests opt-in to making
// a specific adapter sparse by overriding its count. This isolates each test
// to exactly the adapter(s) it cares about, since articleCountsByAdapter
// zero-fills unseen adapters and would otherwise mark them all as sparse.
const ABOVE = String(FIRST_DEPLOY_THRESHOLD + 100);
function platformRows(overrides: Record<string, string> = {}): FakeRow[] {
	const base: Record<string, string> = {
		arxiv: ABOVE,
		devto: ABOVE,
		github: ABOVE,
		hackernews: ABOVE,
		hashnode: ABOVE,
		medium: ABOVE,
		reddit: ABOVE,
		rss: ABOVE
	};
	const merged = { ...base, ...overrides };
	return Object.entries(merged).map(([platform, count]) => ({ platform, count }));
}

describe('maybeAutoEnqueue', () => {
	it('returns feature-flag-off when env.backfill.enabled is false', async () => {
		envModule.env.backfill.enabled = false;
		const handler: QueryHandler = () => ({ rows: [], rowCount: 0 });
		const { executor, calls } = makeExecutor(handler);
		const out = await maybeAutoEnqueue(executor);
		assert.deepEqual(out, { enqueued: [], skipped: ['feature flag off'] });
		assert.equal(calls.length, 0);
		envModule.env.backfill.enabled = true;
	});

	it('enqueues adapters whose count is below FIRST_DEPLOY_THRESHOLD and no coverage exists', async () => {
		envModule.env.backfill.enabled = true;
		const handler: QueryHandler = (sql) => {
			if (/sourcePlatform/.test(sql)) {
				return { rows: platformRows({ arxiv: '5' }), rowCount: 8 };
			}
			if (/SELECT id FROM backfill_runs/.test(sql)) {
				return { rows: [], rowCount: 0 };
			}
			if (/INSERT INTO backfill_runs/.test(sql)) {
				return { rows: [{ id: 'run-1' }], rowCount: 1 };
			}
			if (/INSERT INTO backfill_jobs/.test(sql)) {
				return { rows: [{ id: 'job-1' }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		};
		const { executor } = makeExecutor(handler);

		const out = await maybeAutoEnqueue(executor);
		assert.deepEqual(out.enqueued, ['arxiv']);
		assert.deepEqual(out.skipped, []);
	});

	it('passes the adapter key (not a display name) to backfill_jobs.source_name', async () => {
		envModule.env.backfill.enabled = true;
		let jobInsertParams: unknown[] | null = null;
		const handler: QueryHandler = (sql, params) => {
			if (/sourcePlatform/.test(sql)) {
				return { rows: platformRows({ hackernews: '0' }), rowCount: 8 };
			}
			if (/SELECT id FROM backfill_runs/.test(sql)) {
				return { rows: [], rowCount: 0 };
			}
			if (/INSERT INTO backfill_runs/.test(sql)) {
				return { rows: [{ id: 'run-1' }], rowCount: 1 };
			}
			if (/INSERT INTO backfill_jobs/.test(sql)) {
				jobInsertParams = params;
				return { rows: [{ id: 'job-1' }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		};
		const { executor } = makeExecutor(handler);
		const out = await maybeAutoEnqueue(executor);
		assert.deepEqual(out.enqueued, ['hackernews']);
		assert.equal(
			jobInsertParams![1],
			'hackernews',
			'job.source_name must be the adapter key, not a display name'
		);
	});

	it('skips adapters with existing coverage row', async () => {
		envModule.env.backfill.enabled = true;
		const handler: QueryHandler = (sql) => {
			if (/sourcePlatform/.test(sql)) {
				return { rows: platformRows({ arxiv: '0' }), rowCount: 8 };
			}
			if (/SELECT id FROM backfill_runs/.test(sql)) {
				return { rows: [{ id: 'existing-run' }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		};
		const { executor, calls } = makeExecutor(handler);

		const out = await maybeAutoEnqueue(executor);
		assert.deepEqual(out.enqueued, []);
		assert.deepEqual(out.skipped, ['arxiv']);
		assert.equal(
			calls.some((c) => /INSERT INTO backfill_runs/.test(c.sql)),
			false
		);
	});

	it('coverage check excludes stale complete-with-zero runs so a fixed strategy retries', async () => {
		envModule.env.backfill.enabled = true;
		let capturedCoverageSql: string | null = null;
		const handler: QueryHandler = (sql) => {
			if (/sourcePlatform/.test(sql)) {
				return { rows: platformRows({ arxiv: '0' }), rowCount: 8 };
			}
			if (/SELECT id FROM backfill_runs/.test(sql)) {
				capturedCoverageSql = sql;
				return { rows: [], rowCount: 0 };
			}
			if (/INSERT INTO backfill_runs/.test(sql)) {
				return { rows: [{ id: 'run-1' }], rowCount: 1 };
			}
			if (/INSERT INTO backfill_jobs/.test(sql)) {
				return { rows: [{ id: 'job-1' }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		};
		const { executor } = makeExecutor(handler);
		await maybeAutoEnqueue(executor);
		assert.ok(capturedCoverageSql, 'expected coverage check');
		assert.match(
			capturedCoverageSql!,
			/articles_ingested = 0/,
			'predicate must skip stale zero-ingested complete runs'
		);
		assert.match(
			capturedCoverageSql!,
			/completed_at < now\(\) - /,
			'predicate must enforce a cooldown so fresh empty completes still block'
		);
	});

	it('coverage check excludes failed runs so a failed first-deploy can be retried', async () => {
		envModule.env.backfill.enabled = true;
		let capturedCoverageSql: string | null = null;
		const handler: QueryHandler = (sql) => {
			if (/sourcePlatform/.test(sql)) {
				return { rows: platformRows({ arxiv: '0' }), rowCount: 8 };
			}
			if (/SELECT id FROM backfill_runs/.test(sql)) {
				capturedCoverageSql = sql;
				return { rows: [], rowCount: 0 };
			}
			if (/INSERT INTO backfill_runs/.test(sql)) {
				return { rows: [{ id: 'run-1' }], rowCount: 1 };
			}
			if (/INSERT INTO backfill_jobs/.test(sql)) {
				return { rows: [{ id: 'job-1' }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		};
		const { executor } = makeExecutor(handler);

		const out = await maybeAutoEnqueue(executor);
		assert.deepEqual(out.enqueued, ['arxiv']);
		assert.ok(capturedCoverageSql, 'expected coverage check');
		assert.match(capturedCoverageSql!, /status <> 'failed'/);
	});

	it('skips adapters at or above the threshold', async () => {
		envModule.env.backfill.enabled = true;
		const handler: QueryHandler = (sql) => {
			if (/sourcePlatform/.test(sql)) {
				return { rows: platformRows(), rowCount: 8 };
			}
			return { rows: [], rowCount: 0 };
		};
		const { executor, calls } = makeExecutor(handler);

		const out = await maybeAutoEnqueue(executor);
		assert.deepEqual(out.enqueued, []);
		assert.deepEqual(out.skipped, []);
		assert.equal(
			calls.some((c) => /INSERT INTO backfill_runs/.test(c.sql)),
			false
		);
	});

	it('passes FIRST_DEPLOY_FROM as the window_start of the enqueued run', async () => {
		envModule.env.backfill.enabled = true;
		let capturedRunInsert: unknown[] | null = null;
		const handler: QueryHandler = (sql, params) => {
			if (/sourcePlatform/.test(sql)) {
				return { rows: platformRows({ arxiv: '0' }), rowCount: 8 };
			}
			if (/SELECT id FROM backfill_runs/.test(sql)) {
				return { rows: [], rowCount: 0 };
			}
			if (/INSERT INTO backfill_runs/.test(sql)) {
				capturedRunInsert = params;
				return { rows: [{ id: 'run-1' }], rowCount: 1 };
			}
			if (/INSERT INTO backfill_jobs/.test(sql)) {
				return { rows: [{ id: 'job-1' }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		};
		const { executor } = makeExecutor(handler);
		await maybeAutoEnqueue(executor);

		assert.ok(capturedRunInsert, 'expected backfill_runs insert');
		assert.equal(
			(capturedRunInsert![1] as Date).getTime(),
			FIRST_DEPLOY_FROM.getTime(),
			'window_start should equal FIRST_DEPLOY_FROM'
		);
	});
});
