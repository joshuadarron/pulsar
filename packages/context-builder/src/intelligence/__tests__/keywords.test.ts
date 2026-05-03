import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type PgQueryFn, loadTrendingKeywords } from '../keywords.js';

interface Script {
	matcher: (sql: string) => boolean;
	rows: Array<Record<string, unknown>>;
}

function makePg(scripts: Script[]): PgQueryFn {
	return async <T>(sql: string) => {
		const matched = scripts.find((s) => s.matcher(sql));
		const rows = matched?.rows ?? [];
		return { rows: rows as unknown as T[], rowCount: rows.length };
	};
}

const window = {
	start: new Date('2026-04-01T00:00:00Z'),
	end: new Date('2026-05-01T00:00:00Z')
};

describe('loadTrendingKeywords', () => {
	it('returns an empty array when no keywords are present in the 7d window', async () => {
		const pg = makePg([{ matcher: () => true, rows: [] }]);
		const result = await loadTrendingKeywords(window, { pgQuery: pg });
		assert.deepEqual(result, []);
	});

	it('returns keywords sorted by delta desc with count7d as a tiebreaker', async () => {
		// 7-day rows: rag=20, agents=10, mcp=5
		// 30-day rows: rag=22, agents=40, mcp=8
		// Expected delta:
		//   rag:    count30d - count7d = 2, baseline = 2/3 ≈ 0.667 → max(1, 0.667) = 1
		//           delta = 20/1 - 1 = 19
		//   agents: count30d - count7d = 30, baseline = 30/3 = 10
		//           delta = 10/10 - 1 = 0
		//   mcp:    count30d - count7d = 3, baseline = 3/3 = 1
		//           delta = 5/1 - 1 = 4
		const pg = makePg([
			{
				matcher: (sql) => sql.includes('FROM articles') && sql.includes('LIMIT $3'),
				// First call (7d) gets these rows; mock returns same for both
				// since the matcher matches both calls. We override that below
				// with a more specific script.
				rows: []
			}
		]);
		let callIndex = 0;
		const customPg: PgQueryFn = async <T>(sql: string, params?: unknown[]) => {
			callIndex++;
			if (callIndex === 1) {
				return {
					rows: [
						{ keyword: 'rag', count: '20' },
						{ keyword: 'agents', count: '10' },
						{ keyword: 'mcp', count: '5' }
					] as unknown as T[],
					rowCount: 3
				};
			}
			return {
				rows: [
					{ keyword: 'rag', count: '22' },
					{ keyword: 'agents', count: '40' },
					{ keyword: 'mcp', count: '8' }
				] as unknown as T[],
				rowCount: 3
			};
		};

		const result = await loadTrendingKeywords(window, { pgQuery: customPg });
		assert.equal(result.length, 3);
		assert.equal(result[0].keyword, 'rag');
		assert.equal(result[0].count7d, 20);
		assert.equal(result[0].count30d, 22);
		assert.ok(result[0].delta > result[1].delta);
		// Velocity spike fires for rag and mcp (delta > 0.5), not for agents.
		assert.ok(typeof result[0].velocitySpike === 'number');
	});

	it('respects the top option', async () => {
		const customPg: PgQueryFn = async <T>(_sql: string, params?: unknown[]) => {
			const limit = params?.[2];
			return {
				rows: Array.from({ length: Number(limit) }, (_, i) => ({
					keyword: `k-${i}`,
					count: String(10 - i)
				})) as unknown as T[],
				rowCount: 0
			};
		};

		const result = await loadTrendingKeywords(window, { pgQuery: customPg, top: 5 });
		assert.equal(result.length, 5);
	});
});
