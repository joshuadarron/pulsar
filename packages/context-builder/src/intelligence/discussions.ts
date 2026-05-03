import { getSession } from '@pulsar/shared/db/neo4j';
import { query as pgQuery } from '@pulsar/shared/db/postgres';

import type { IntelligenceAuthor, IntelligenceDiscussion, IntelligenceWindow } from '../types.js';
import type { Neo4jSessionLike } from './snapshot.js';

const DEFAULT_TOP_DISCUSSIONS = 10;
const DEFAULT_TOP_AUTHORS = 5;
const DEFAULT_TOP_EMERGING = 10;

export type PgQueryFn = <T = Record<string, unknown>>(
	sql: string,
	params?: unknown[]
) => Promise<{ rows: T[]; rowCount: number | null }>;

export type DiscussionsDeps = {
	pgQuery?: PgQueryFn;
	getSession?: () => Neo4jSessionLike;
};

/**
 * Top discussions in the window by engagement (`comment_count` desc).
 * Mirrors the `gatherDeveloperSignalsInputs` SQL from the runner, with the
 * window passed in as parameters instead of `now() - interval '7 days'`.
 */
export async function loadTopDiscussions(
	window: IntelligenceWindow,
	opts: { top?: number; pgQuery?: PgQueryFn } = {}
): Promise<IntelligenceDiscussion[]> {
	const top = opts.top ?? DEFAULT_TOP_DISCUSSIONS;
	const pg = opts.pgQuery ?? defaultPgQuery;
	if (top <= 0) return [];

	const result = await pg<{
		title: string;
		url: string;
		comment_count: string;
		source_name: string;
	}>(
		`SELECT title, url, COALESCE(comment_count, 0)::text AS comment_count, source_name
		 FROM articles
		 WHERE published_at >= $1 AND published_at <= $2
		   AND comment_count IS NOT NULL AND comment_count > 0
		 ORDER BY comment_count DESC
		 LIMIT $3`,
		[window.start.toISOString(), window.end.toISOString(), top]
	);

	return result.rows.map((row) => ({
		title: row.title,
		url: row.url,
		source: row.source_name ?? 'unknown',
		commentCount: Number.parseInt(row.comment_count, 10)
	}));
}

/**
 * Top authors in the window, computed from Neo4j `Author` nodes and their
 * `AUTHORED_BY` relationships. Result is sorted by article count desc.
 */
export async function loadTopAuthors(
	window: IntelligenceWindow,
	opts: { top?: number; getSession?: () => Neo4jSessionLike } = {}
): Promise<IntelligenceAuthor[]> {
	const top = opts.top ?? DEFAULT_TOP_AUTHORS;
	const sessionFactory = opts.getSession ?? (() => getSession() as unknown as Neo4jSessionLike);
	if (top <= 0) return [];

	const session = sessionFactory();
	try {
		const result = await session.run(
			`MATCH (au:Author)<-[:AUTHORED_BY]-(a:Article)
			 WHERE a.publishedAt >= datetime($start) AND a.publishedAt <= datetime($end)
			 RETURN au.handle AS handle, au.platform AS platform, count(a) AS articleCount
			 ORDER BY articleCount DESC
			 LIMIT $top`,
			{ start: window.start.toISOString(), end: window.end.toISOString(), top }
		);
		return result.records.map((record) => ({
			handle: record.get('handle') as string,
			platform: (record.get('platform') as string) || 'unknown',
			articleCount: neoToNum(record.get('articleCount'))
		}));
	} finally {
		await session.close();
	}
}

/**
 * Sentiment distribution for articles in the window. Shapes match the
 * runner: positive / neutral / negative integer counts. Always returns all
 * three keys; an empty period yields zeros for each.
 */
export async function loadSentimentBreakdown(
	window: IntelligenceWindow,
	opts: { pgQuery?: PgQueryFn } = {}
): Promise<{ positive: number; neutral: number; negative: number }> {
	const pg = opts.pgQuery ?? defaultPgQuery;
	const result = await pg<{ sentiment: string; count: string }>(
		`SELECT COALESCE(sentiment, 'neutral') AS sentiment, count(*)::text AS count
		 FROM articles
		 WHERE published_at >= $1 AND published_at <= $2
		 GROUP BY sentiment`,
		[window.start.toISOString(), window.end.toISOString()]
	);

	const breakdown = { positive: 0, neutral: 0, negative: 0 };
	for (const row of result.rows) {
		const key = row.sentiment as keyof typeof breakdown;
		if (key in breakdown) {
			breakdown[key] = Number.parseInt(row.count, 10);
		}
	}
	return breakdown;
}

/**
 * Emerging topics: Neo4j topics whose `firstSeen` is within the last 14 days
 * relative to `window.end` and whose `trendScore` is above 1. Returns just
 * the topic names so the caller can format them however they like.
 */
export async function loadEmergingTopics(
	window: IntelligenceWindow,
	opts: { top?: number; getSession?: () => Neo4jSessionLike } = {}
): Promise<string[]> {
	const top = opts.top ?? DEFAULT_TOP_EMERGING;
	const sessionFactory = opts.getSession ?? (() => getSession() as unknown as Neo4jSessionLike);
	if (top <= 0) return [];

	const fourteenDaysAgo = new Date(window.end.getTime() - 14 * 24 * 60 * 60 * 1000);

	const session = sessionFactory();
	try {
		const result = await session.run(
			`MATCH (t:Topic)
			 WHERE t.firstSeen >= datetime($since) AND t.trendScore > 1
			 RETURN t.name AS name
			 ORDER BY t.trendScore DESC
			 LIMIT $top`,
			{ since: fourteenDaysAgo.toISOString(), top }
		);
		return result.records.map((record) => record.get('name') as string);
	} finally {
		await session.close();
	}
}

function neoToNum(value: unknown): number {
	if (typeof value === 'object' && value !== null && 'toNumber' in value) {
		return (value as { toNumber(): number }).toNumber();
	}
	return Number(value ?? 0);
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
