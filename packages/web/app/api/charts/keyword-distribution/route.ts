import { query } from '@pulsar/shared/db/postgres';
import { type NextRequest, NextResponse } from 'next/server';

interface KeywordRow {
	keyword: string;
	count: string;
}

interface TotalRow {
	total: string;
}

interface ArticlesRow {
	total_articles: string;
}

interface KeywordDistributionEntry {
	keyword: string;
	count: number;
	pct: number;
}

interface KeywordDistributionResponse {
	meta: {
		windowStart: string;
		windowEnd: string;
		totalArticles: number;
	};
	distribution: KeywordDistributionEntry[];
}

const DEFAULT_TOP = 10;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_TOP = 100;
const MAX_WINDOW_DAYS = 365;

/**
 * Parse a positive integer query param, falling back to `fallback` for missing
 * or invalid values. Caps at `max` to keep query cost bounded.
 */
function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.min(parsed, max);
}

/**
 * GET /api/charts/keyword-distribution
 *
 * Returns the top N most-mentioned keywords from `articles.topic_tags` over
 * the last `windowDays` days, plus an `Other` aggregate for the long tail.
 *
 * Query params:
 *   top         (default 10, max 100): number of distinct keywords to return
 *                                      before bucketing the rest into `Other`.
 *   windowDays  (default 30, max 365): look-back window in days, anchored to now.
 *
 * Empty result shape: `{ meta: { ..., totalArticles: 0 }, distribution: [] }`.
 * Never throws on sparse data.
 *
 * Auth: protected by middleware (matcher in packages/web/middleware.ts).
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const top = parsePositiveInt(searchParams.get('top'), DEFAULT_TOP, MAX_TOP);
	const windowDays = parsePositiveInt(
		searchParams.get('windowDays'),
		DEFAULT_WINDOW_DAYS,
		MAX_WINDOW_DAYS
	);

	const windowEnd = new Date();
	const windowStart = new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

	const articlesResult = await query<ArticlesRow>(
		`SELECT COUNT(*)::text AS total_articles
		 FROM articles
		 WHERE published_at >= $1 AND published_at <= $2`,
		[windowStart.toISOString(), windowEnd.toISOString()]
	);
	const totalArticles = Number.parseInt(articlesResult.rows[0]?.total_articles ?? '0', 10);

	if (totalArticles === 0) {
		const empty: KeywordDistributionResponse = {
			meta: {
				windowStart: windowStart.toISOString(),
				windowEnd: windowEnd.toISOString(),
				totalArticles: 0
			},
			distribution: []
		};
		return NextResponse.json(empty);
	}

	const totalsResult = await query<TotalRow>(
		`SELECT COUNT(*)::text AS total
		 FROM articles, unnest(topic_tags) AS keyword
		 WHERE published_at >= $1 AND published_at <= $2
		   AND topic_tags IS NOT NULL`,
		[windowStart.toISOString(), windowEnd.toISOString()]
	);
	const totalMentions = Number.parseInt(totalsResult.rows[0]?.total ?? '0', 10);

	if (totalMentions === 0) {
		const empty: KeywordDistributionResponse = {
			meta: {
				windowStart: windowStart.toISOString(),
				windowEnd: windowEnd.toISOString(),
				totalArticles
			},
			distribution: []
		};
		return NextResponse.json(empty);
	}

	const topResult = await query<KeywordRow>(
		`SELECT keyword, COUNT(*)::text AS count
		 FROM articles, unnest(topic_tags) AS keyword
		 WHERE published_at >= $1 AND published_at <= $2
		   AND topic_tags IS NOT NULL
		 GROUP BY keyword
		 ORDER BY COUNT(*) DESC, keyword ASC
		 LIMIT $3`,
		[windowStart.toISOString(), windowEnd.toISOString(), top]
	);

	const topEntries: KeywordDistributionEntry[] = topResult.rows.map((row) => {
		const count = Number.parseInt(row.count, 10);
		return {
			keyword: row.keyword,
			count,
			pct: totalMentions > 0 ? (count / totalMentions) * 100 : 0
		};
	});

	const topSum = topEntries.reduce((acc, entry) => acc + entry.count, 0);
	const otherCount = totalMentions - topSum;

	const distribution: KeywordDistributionEntry[] = [...topEntries];
	if (otherCount > 0) {
		distribution.push({
			keyword: 'Other',
			count: otherCount,
			pct: (otherCount / totalMentions) * 100
		});
	}

	const response: KeywordDistributionResponse = {
		meta: {
			windowStart: windowStart.toISOString(),
			windowEnd: windowEnd.toISOString(),
			totalArticles
		},
		distribution
	};

	return NextResponse.json(response);
}
