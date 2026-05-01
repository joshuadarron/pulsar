import { createHash } from 'node:crypto';
import { query } from '@pulsar/shared/db/postgres';
import type { Article, SourceOrigin } from '@pulsar/shared/types';

/**
 * Minimal database executor surface used by dedup and backfill helpers.
 * Compatible with pg's `Pool` and `PoolClient` so callers can pass either the
 * shared pool or a transaction-bound client without coupling this package
 * directly to `pg`.
 */
export type DbExecutor = {
	query<T = unknown>(
		sql: string,
		params?: unknown[]
	): Promise<{ rows: T[]; rowCount: number | null }>;
};

/**
 * Strip common tracking and search query parameters and trim trailing slash.
 * Used by the composite hash so backfilled URLs that differ only by query
 * decoration deduplicate against each other.
 */
function normalizeUrlForComposite(url: string): string {
	const trimmed = url.trim().toLowerCase();
	const queryIndex = trimmed.indexOf('?');
	const hashIndex = trimmed.indexOf('#');
	let cutoff = trimmed.length;
	if (queryIndex !== -1) cutoff = Math.min(cutoff, queryIndex);
	if (hashIndex !== -1) cutoff = Math.min(cutoff, hashIndex);
	const stripped = trimmed.slice(0, cutoff);
	if (stripped.length > 1 && stripped.endsWith('/')) {
		return stripped.slice(0, -1);
	}
	return stripped;
}

/**
 * Format a Date as an ISO-8601 UTC string truncated to seconds, e.g.
 * `2024-01-15T08:30:00Z`. Wayback CDX timestamps often only carry day-level
 * precision; callers may pass a Date with hours/minutes/seconds zeroed and
 * still get a stable composite hash.
 */
function publishedAtToIso(publishedAt: Date): string {
	const iso = publishedAt.toISOString();
	// Trim milliseconds: 2024-01-15T08:30:00.000Z -> 2024-01-15T08:30:00Z
	return iso.replace(/\.\d{3}Z$/, 'Z');
}

/** Live-item dedup hash: SHA-256 of trimmed lowercased URL. Unchanged. */
export function hashUrl(url: string): string {
	return createHash('sha256').update(url.trim().toLowerCase()).digest('hex');
}

/**
 * Backfill-item dedup hash: SHA-256 of `${sourceName}|${normalizedUrl}|${publishedAtIso}`.
 *
 * Uses a composite key so a wayback ingestion of a recent date does not collide
 * with a live ingestion of the same URL: the live row uses `url_hash` UNIQUE
 * while the backfill row uses `composite_hash` UNIQUE. They can coexist.
 */
export function hashComposite(
	sourceName: string,
	publishedAt: Date,
	normalizedUrl: string
): string {
	const url = normalizeUrlForComposite(normalizedUrl);
	const iso = publishedAtToIso(publishedAt);
	const input = `${sourceName}|${url}|${iso}`;
	return createHash('sha256').update(input).digest('hex');
}

export async function exists(urlHash: string): Promise<boolean> {
	const result = await query('SELECT 1 FROM articles_raw WHERE url_hash = $1 LIMIT 1', [urlHash]);
	return result.rowCount! > 0;
}

/**
 * Check whether a backfill `composite_hash` already exists. Accepts either a
 * Pool or a PoolClient; the pool default keeps backward compatibility with
 * call sites that don't manage their own transaction.
 */
export async function existsCompositeHash(executor: DbExecutor, hash: string): Promise<boolean> {
	const result = await executor.query(
		'SELECT 1 FROM articles_raw WHERE composite_hash = $1 LIMIT 1',
		[hash]
	);
	return (result.rowCount ?? 0) > 0;
}

type ArticleWithOrigin = Article & { sourceOrigin?: SourceOrigin };

/**
 * Resolve duplicate articles that share a canonical URL by preferring the
 * `live` source origin. Used by read paths that join live + backfilled rows
 * and want a single representative per URL.
 *
 * Backfilled rows are kept only when no live row exists for the same URL.
 * Order within a group is preserved (first wins) so callers can pre-sort by
 * recency or score.
 */
export function dedupArticlesByOrigin<T extends ArticleWithOrigin>(rows: T[]): T[] {
	const byUrl = new Map<string, T>();
	for (const row of rows) {
		const key = normalizeUrlForComposite(row.url);
		const existing = byUrl.get(key);
		if (!existing) {
			byUrl.set(key, row);
			continue;
		}
		const existingIsLive = (existing.sourceOrigin ?? 'live') === 'live';
		const candidateIsLive = (row.sourceOrigin ?? 'live') === 'live';
		if (!existingIsLive && candidateIsLive) {
			byUrl.set(key, row);
		}
	}
	return Array.from(byUrl.values());
}
