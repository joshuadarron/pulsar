import { query as pgQuery } from '@pulsar/shared/db/postgres';

import type { IntelligenceKeyword, IntelligenceWindow } from '../types.js';

const DEFAULT_TOP = 20;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type PgQueryFn = <T = Record<string, unknown>>(
	sql: string,
	params?: unknown[]
) => Promise<{ rows: T[]; rowCount: number | null }>;

export type LoadKeywordsOptions = {
	top?: number;
	pgQuery?: PgQueryFn;
};

/**
 * Compute trending keywords from `articles.topic_tags` over a 7-day window
 * relative to `window.end`, with a 30-day baseline.
 *
 *   count7d  number of mentions in (windowEnd - 7d, windowEnd]
 *   count30d number of mentions in (windowEnd - 30d, windowEnd]
 *   delta    a velocity ratio comparing recent volume to the older baseline
 *
 * `delta` matches the historical formula:
 *   delta = count7d / max(1, ((count30d - count7d) / 3 || 1)) - 1
 * which compares the 7-day count to the average weekly count in the prior
 * three weeks. A value above 0.5 is flagged as a velocity spike.
 *
 * Results are sorted by `delta` desc with `count7d` as a tiebreaker so the
 * caller can take the most accelerating keywords directly.
 */
export async function loadTrendingKeywords(
	window: IntelligenceWindow,
	opts: LoadKeywordsOptions = {}
): Promise<IntelligenceKeyword[]> {
	const top = opts.top ?? DEFAULT_TOP;
	const pg: PgQueryFn = opts.pgQuery ?? defaultPgQuery;
	if (top <= 0) return [];

	const windowEnd = window.end;
	const sevenStart = new Date(windowEnd.getTime() - SEVEN_DAYS_MS);
	const thirtyStart = new Date(windowEnd.getTime() - THIRTY_DAYS_MS);

	const sevenResult = await pg<{ keyword: string; count: string }>(
		`SELECT unnest(topic_tags) AS keyword, count(*)::text AS count
		 FROM articles
		 WHERE published_at > $1 AND published_at <= $2 AND topic_tags IS NOT NULL
		 GROUP BY keyword
		 ORDER BY count(*) DESC
		 LIMIT $3`,
		[sevenStart.toISOString(), windowEnd.toISOString(), top]
	);

	if (sevenResult.rows.length === 0) return [];

	const thirtyResult = await pg<{ keyword: string; count: string }>(
		`SELECT unnest(topic_tags) AS keyword, count(*)::text AS count
		 FROM articles
		 WHERE published_at > $1 AND published_at <= $2 AND topic_tags IS NOT NULL
		 GROUP BY keyword
		 ORDER BY count(*) DESC
		 LIMIT $3`,
		[thirtyStart.toISOString(), windowEnd.toISOString(), Math.max(top + 10, 30)]
	);

	const thirtyMap = new Map<string, number>();
	for (const row of thirtyResult.rows) {
		thirtyMap.set(row.keyword, Number.parseInt(row.count, 10));
	}

	const keywords: IntelligenceKeyword[] = sevenResult.rows.map((row) => {
		const count7d = Number.parseInt(row.count, 10);
		const count30d = thirtyMap.get(row.keyword) ?? count7d;
		const baselinePerWeek = (count30d - count7d) / 3 || 1;
		const delta = count7d / Math.max(1, baselinePerWeek) - 1;
		const keyword: IntelligenceKeyword = {
			keyword: row.keyword,
			count7d,
			count30d,
			delta
		};
		if (delta > 0.5) {
			keyword.velocitySpike = count7d / Math.max(1, count30d / 4);
		}
		return keyword;
	});

	keywords.sort((a, b) => {
		if (b.delta !== a.delta) return b.delta - a.delta;
		return b.count7d - a.count7d;
	});

	return keywords;
}

const defaultPgQuery: PgQueryFn = async <T = Record<string, unknown>>(
	sql: string,
	params?: unknown[]
) => {
	const result = await pgQuery(sql, params);
	return {
		rows: result.rows as unknown as T[],
		rowCount: result.rowCount
	};
};
