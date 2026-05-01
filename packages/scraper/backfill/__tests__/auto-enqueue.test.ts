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

	it('enqueues sources whose count is below FIRST_DEPLOY_THRESHOLD and no coverage exists', async () => {
		envModule.env.backfill.enabled = true;
		const handler: QueryHandler = (sql) => {
			if (/SELECT source_name, COUNT/.test(sql)) {
				return {
					rows: [
						{ source_name: 'arxiv', count: '5' },
						{ source_name: 'reddit', count: '1000' }
					],
					rowCount: 2
				};
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

	it('skips sources with existing coverage row', async () => {
		envModule.env.backfill.enabled = true;
		const handler: QueryHandler = (sql) => {
			if (/SELECT source_name, COUNT/.test(sql)) {
				return { rows: [{ source_name: 'arxiv', count: '0' }], rowCount: 1 };
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
		// Did NOT call enqueue path.
		assert.equal(
			calls.some((c) => /INSERT INTO backfill_runs/.test(c.sql)),
			false
		);
	});

	it('skips sources at or above the threshold', async () => {
		envModule.env.backfill.enabled = true;
		const handler: QueryHandler = (sql) => {
			if (/SELECT source_name, COUNT/.test(sql)) {
				return {
					rows: [
						{ source_name: 'arxiv', count: String(FIRST_DEPLOY_THRESHOLD) },
						{ source_name: 'reddit', count: String(FIRST_DEPLOY_THRESHOLD + 1) }
					],
					rowCount: 2
				};
			}
			return { rows: [], rowCount: 0 };
		};
		const { executor, calls } = makeExecutor(handler);

		const out = await maybeAutoEnqueue(executor);
		assert.deepEqual(out.enqueued, []);
		assert.deepEqual(out.skipped, []);
		// No coverage check or insert performed.
		assert.equal(
			calls.some((c) => /INSERT INTO backfill_runs/.test(c.sql)),
			false
		);
	});

	it('passes FIRST_DEPLOY_FROM as the window_start of the enqueued run', async () => {
		envModule.env.backfill.enabled = true;
		let capturedRunInsert: unknown[] | null = null;
		const handler: QueryHandler = (sql, params) => {
			if (/SELECT source_name, COUNT/.test(sql)) {
				return { rows: [{ source_name: 'arxiv', count: '0' }], rowCount: 1 };
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
