import type { ScrapedItem, SourceOrigin } from '@pulsar/shared/types';

import type { DbExecutor } from '../dedup.js';
import { existsCompositeHash, hashComposite, hashUrl } from '../dedup.js';

const DEFAULT_BACKFILL_ORIGIN: SourceOrigin = 'wayback';

/**
 * Insert backfilled `ScrapedItem`s into `articles_raw` with backfill metadata.
 *
 * For each item:
 *   1. Compute composite_hash via hashComposite(sourceName, publishedAt, url).
 *   2. Skip if a row with that composite_hash already exists.
 *   3. INSERT into articles_raw with source_origin, composite_hash, and
 *      backfill_run_id, plus the standard live-path columns (url, raw_payload,
 *      source_name, scraped_at via DEFAULT now()).
 *
 * Returns the count of rows actually inserted (skipped duplicates excluded).
 *
 * @param executor pg Pool or PoolClient. Caller controls transaction scope.
 * @param items strategy output items, already tagged with sourceOrigin.
 * @param backfillRunId FK to backfill_runs.id this batch belongs to.
 */
export async function insertBackfilledItems(
	executor: DbExecutor,
	items: ScrapedItem[],
	backfillRunId: string
): Promise<number> {
	let inserted = 0;
	for (const item of items) {
		const compositeHash = hashComposite(item.sourceName, item.publishedAt, item.url);
		if (await existsCompositeHash(executor, compositeHash)) continue;

		const sourceOrigin: SourceOrigin = item.sourceOrigin ?? DEFAULT_BACKFILL_ORIGIN;
		const urlHash = hashUrl(item.url);

		try {
			await executor.query(
				`INSERT INTO articles_raw
           (url_hash, url, raw_payload, source_name, source_origin, composite_hash, backfill_run_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (composite_hash) DO NOTHING`,
				[
					urlHash,
					item.url,
					JSON.stringify(item),
					item.sourceName,
					sourceOrigin,
					compositeHash,
					backfillRunId
				]
			);
			inserted += 1;
		} catch (err: unknown) {
			// url_hash UNIQUE collisions with a live row are expected when wayback
			// rediscovers a URL we already have live. Treat as a skip, not an error.
			if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
				continue;
			}
			throw err;
		}
	}
	return inserted;
}
