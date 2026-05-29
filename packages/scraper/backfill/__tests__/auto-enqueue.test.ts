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

const { enqueueMonthlyCoverage } = await import('../auto-enqueue.js');
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

// Returns an exec handler that says "this adapter has these missing months;
// every other adapter is fully covered" so each test focuses on one adapter.
// The platforms-list param is what we key off (BACKFILL_PLATFORMS maps the
// adapter key to a list of platform strings; we look up by the first one).
function handlerWithMissingMonths(missingByAdapter: Record<string, Date[]>): {
	handler: QueryHandler;
	inserts: Recorded[];
} {
	const inserts: Recorded[] = [];
	const handler: QueryHandler = (sql, params) => {
		if (/SELECT m.month_start/.test(sql)) {
			const platforms = params[1] as string[];
			const key = platforms[0];
			const months = missingByAdapter[key] ?? [];
			return { rows: months.map((d) => ({ month_start: d })), rowCount: months.length };
		}
		if (/INSERT INTO backfill_runs/.test(sql)) {
			inserts.push({ sql, params });
			return { rows: [{ id: `run-${inserts.length}` }], rowCount: 1 };
		}
		if (/INSERT INTO backfill_jobs/.test(sql)) {
			return { rows: [{ id: `job-${inserts.length}` }], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	};
	return { handler, inserts };
}

describe('enqueueMonthlyCoverage', () => {
	it('returns feature-flag-off when env.backfill.enabled is false', async () => {
		envModule.env.backfill.enabled = false;
		const handler: QueryHandler = () => ({ rows: [], rowCount: 0 });
		const { executor, calls } = makeExecutor(handler);
		const out = await enqueueMonthlyCoverage(executor);
		assert.deepEqual(out, { enqueued: [], skipped: ['feature flag off'] });
		assert.equal(calls.length, 0);
		envModule.env.backfill.enabled = true;
	});

	it('enqueues the newest missing month per adapter, one per tick', async () => {
		envModule.env.backfill.enabled = true;
		const { handler, inserts } = handlerWithMissingMonths({
			devto: [
				new Date('2024-03-01T00:00:00Z'),
				new Date('2024-02-01T00:00:00Z')
			]
		});
		const { executor } = makeExecutor(handler);
		const out = await enqueueMonthlyCoverage(executor);

		assert.ok(
			out.enqueued.some((s) => s.startsWith('devto@2024-03')),
			'newest devto missing month should be enqueued'
		);
		// Only the first missing month is enqueued for devto (one per tick).
		const devtoInserts = inserts.filter((i) => i.params[0] === 'devto');
		assert.equal(devtoInserts.length, 1, 'one insert per adapter per tick');
		const start = devtoInserts[0].params[1] as Date;
		const end = devtoInserts[0].params[2] as Date;
		assert.equal(start.toISOString(), '2024-03-01T00:00:00.000Z');
		assert.equal(end.toISOString(), '2024-04-01T00:00:00.000Z');
	});

	it('passes the adapter key (not a display name) to backfill_jobs.source_name', async () => {
		envModule.env.backfill.enabled = true;
		let jobInsertParams: unknown[] | null = null;
		const handler: QueryHandler = (sql, params) => {
			if (/SELECT m.month_start/.test(sql)) {
				const platforms = params[1] as string[];
				if (platforms.includes('hackernews')) {
					return { rows: [{ month_start: new Date('2025-01-01T00:00:00Z') }], rowCount: 1 };
				}
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
		const out = await enqueueMonthlyCoverage(executor);
		assert.ok(out.enqueued.some((s) => s.startsWith('hackernews@')));
		assert.equal(
			jobInsertParams![1],
			'hackernews',
			'job.source_name must be the adapter key, not a display name'
		);
		assert.equal(jobInsertParams![4], 'month-fill');
	});

	it('skips adapters with no missing months', async () => {
		envModule.env.backfill.enabled = true;
		const handler: QueryHandler = (sql) => {
			if (/SELECT m.month_start/.test(sql)) {
				return { rows: [], rowCount: 0 };
			}
			return { rows: [], rowCount: 0 };
		};
		const { executor, calls } = makeExecutor(handler);
		const out = await enqueueMonthlyCoverage(executor);
		assert.equal(out.enqueued.length, 0);
		assert.ok(out.skipped.length >= 1, 'all adapters fully covered should be in skipped');
		assert.equal(
			calls.some((c) => /INSERT INTO backfill_runs/.test(c.sql)),
			false
		);
	});
});
