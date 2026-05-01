import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ScrapedItem } from '@pulsar/shared/types';

import { insertBackfilledItems } from '../insert.js';

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

function buildItem(overrides: Partial<ScrapedItem> = {}): ScrapedItem {
	return {
		url: 'https://example.com/a',
		title: 'Example A',
		rawContent: 'body',
		publishedAt: new Date('2024-01-15T08:30:00Z'),
		sourceName: 'arxiv',
		sourcePlatform: 'arxiv',
		sourceOrigin: 'direct_archive',
		...overrides
	};
}

describe('insertBackfilledItems', () => {
	it('skips items whose composite_hash already exists', async () => {
		const handler: QueryHandler = (sql) => {
			if (/SELECT 1 FROM articles_raw WHERE composite_hash/.test(sql)) {
				return { rows: [{ exists: 1 }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		};
		const { executor, calls } = makeExecutor(handler);

		const inserted = await insertBackfilledItems(executor, [buildItem()], 'run-1');
		assert.equal(inserted, 0);
		// One existence check, zero INSERTs.
		assert.equal(calls.length, 1);
		assert.match(calls[0].sql, /SELECT 1 FROM articles_raw WHERE composite_hash/);
	});

	it('inserts new items with source_origin, composite_hash, backfill_run_id', async () => {
		const handler: QueryHandler = (sql) => {
			if (/SELECT 1 FROM articles_raw WHERE composite_hash/.test(sql)) {
				return { rows: [], rowCount: 0 };
			}
			return { rows: [], rowCount: 1 };
		};
		const { executor, calls } = makeExecutor(handler);

		const item = buildItem({ sourceOrigin: 'direct_archive' });
		const inserted = await insertBackfilledItems(executor, [item], 'run-xyz');

		assert.equal(inserted, 1);
		const insertCall = calls.find((c) => /INSERT INTO articles_raw/.test(c.sql));
		assert.ok(insertCall, 'expected an INSERT call');
		const params = insertCall.params;
		// (urlHash, url, raw_payload, source_name, source_origin, composite_hash, backfill_run_id)
		assert.equal(params[1], 'https://example.com/a');
		assert.equal(params[3], 'arxiv');
		assert.equal(params[4], 'direct_archive');
		// composite_hash is 64-char hex.
		assert.match(String(params[5]), /^[a-f0-9]{64}$/);
		assert.equal(params[6], 'run-xyz');
	});

	it('defaults source_origin to wayback when item leaves it unset', async () => {
		const handler: QueryHandler = (sql) => {
			if (/SELECT 1 FROM articles_raw WHERE composite_hash/.test(sql)) {
				return { rows: [], rowCount: 0 };
			}
			return { rows: [], rowCount: 1 };
		};
		const { executor, calls } = makeExecutor(handler);

		const item = buildItem({ sourceOrigin: undefined });
		await insertBackfilledItems(executor, [item], 'run-1');
		const insertCall = calls.find((c) => /INSERT INTO articles_raw/.test(c.sql));
		assert.ok(insertCall);
		assert.equal(insertCall.params[4], 'wayback');
	});

	it('counts only inserted rows, mixed dedup + insert batch', async () => {
		// Existence map: only the second URL is already present.
		const seen = new Set<string>();
		const handler: QueryHandler = (sql, params) => {
			if (/SELECT 1 FROM articles_raw WHERE composite_hash/.test(sql)) {
				const hash = String(params[0]);
				return seen.has(hash) ? { rows: [{ x: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
			}
			return { rows: [], rowCount: 1 };
		};
		const { executor } = makeExecutor(handler);

		// Pre-mark item2's composite hash as existing.
		const items: ScrapedItem[] = [
			buildItem({ url: 'https://example.com/one' }),
			buildItem({ url: 'https://example.com/two' }),
			buildItem({ url: 'https://example.com/three' })
		];
		// Compute item2's hash to mark it as seen ahead of time.
		const { hashComposite } = await import('../../dedup.js');
		seen.add(hashComposite(items[1].sourceName, items[1].publishedAt, items[1].url));

		const inserted = await insertBackfilledItems(executor, items, 'run-1');
		assert.equal(inserted, 2);
	});

	it('treats unique-violation on url_hash as a skip, not an error', async () => {
		const handler: QueryHandler = (sql) => {
			if (/SELECT 1 FROM articles_raw WHERE composite_hash/.test(sql)) {
				return { rows: [], rowCount: 0 };
			}
			const err = new Error('duplicate key') as Error & { code?: string };
			err.code = '23505';
			throw err;
		};
		const { executor } = makeExecutor(handler);

		const inserted = await insertBackfilledItems(executor, [buildItem()], 'run-1');
		assert.equal(inserted, 0);
	});

	it('rethrows non-unique-violation insert errors', async () => {
		const handler: QueryHandler = (sql) => {
			if (/SELECT 1 FROM articles_raw WHERE composite_hash/.test(sql)) {
				return { rows: [], rowCount: 0 };
			}
			throw new Error('disk full');
		};
		const { executor } = makeExecutor(handler);

		await assert.rejects(
			() => insertBackfilledItems(executor, [buildItem()], 'run-1'),
			/disk full/
		);
	});
});
