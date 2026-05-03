import { query as pgQuery } from '@pulsar/shared/db/postgres';

import type { IntelligenceContext, IntelligenceWindow } from '../types.js';

import { loadTopicClusters } from './clusters.js';
import {
	loadEmergingTopics,
	loadSentimentBreakdown,
	loadTopAuthors,
	loadTopDiscussions
} from './discussions.js';
import { loadEntities } from './entities.js';
import { loadTrendingKeywords } from './keywords.js';
import { type GetOrComputeSnapshotOptions, getOrComputeSnapshot } from './snapshot.js';

export type BuildIntelligenceOptions = {
	window: IntelligenceWindow;
	preferredSnapshotId?: string;
	forceRecomputeSnapshot?: boolean;
	runId?: string;
	/** Top entities returned by PageRank rank. Defaults to 20. */
	topEntities?: number;
	/** Whether to enrich entities with 12-month history. Defaults to true. */
	includeEntityHistory?: boolean;
};

/**
 * Build the full `IntelligenceContext` for a window:
 *
 *   1. Resolve a graph snapshot (cached, recomputed, or pre-supplied).
 *   2. In parallel, gather entities, keywords, clusters, top discussions,
 *      top authors, sentiment, emerging topics, and the article/source
 *      counts for metadata.
 *   3. Compose into the typed context shape returned to the caller.
 *
 * The function never throws on sparse data; empty windows yield an
 * `IntelligenceContext` with zero counts and empty arrays.
 */
export async function buildIntelligence(
	opts: BuildIntelligenceOptions
): Promise<IntelligenceContext> {
	const snapshotOpts: GetOrComputeSnapshotOptions = {
		window: opts.window,
		preferredId: opts.preferredSnapshotId,
		forceRecompute: opts.forceRecomputeSnapshot,
		runId: opts.runId
	};

	const snapshot = await getOrComputeSnapshot(snapshotOpts);

	const includeHistory = opts.includeEntityHistory ?? true;
	const topEntities = opts.topEntities ?? 20;

	const [
		entities,
		trendingKeywords,
		topicClusters,
		topDiscussions,
		topAuthors,
		sentimentBreakdown,
		emergingTopics,
		counts
	] = await Promise.all([
		loadEntities(opts.window, snapshot, { topN: topEntities, includeHistory }),
		loadTrendingKeywords(opts.window),
		loadTopicClusters(snapshot),
		loadTopDiscussions(opts.window),
		loadTopAuthors(opts.window),
		loadSentimentBreakdown(opts.window),
		loadEmergingTopics(opts.window),
		loadCounts(opts.window)
	]);

	return {
		period: opts.window,
		graphSnapshotId: snapshot.snapshot.id,
		graphSnapshotSource: snapshot.source,
		articleCount: counts.articleCount,
		sourceCount: counts.sourceCount,
		entities,
		trendingKeywords,
		topicClusters,
		topDiscussions,
		sentimentBreakdown,
		topAuthors,
		emergingTopics
	};
}

async function loadCounts(
	window: IntelligenceWindow
): Promise<{ articleCount: number; sourceCount: number }> {
	const result = await pgQuery<{ article_count: string; source_count: string }>(
		`SELECT count(*)::text AS article_count,
		        count(DISTINCT source_name)::text AS source_count
		 FROM articles
		 WHERE published_at >= $1 AND published_at <= $2`,
		[window.start.toISOString(), window.end.toISOString()]
	);
	const row = result.rows[0];
	return {
		articleCount: row ? Number.parseInt(row.article_count, 10) : 0,
		sourceCount: row ? Number.parseInt(row.source_count, 10) : 0
	};
}

export {
	getOrComputeSnapshot,
	type GetOrComputeSnapshotOptions,
	type SnapshotResolution
} from './snapshot.js';
export { loadEntities } from './entities.js';
export { loadTrendingKeywords } from './keywords.js';
export { loadTopicClusters } from './clusters.js';
export {
	loadEmergingTopics,
	loadSentimentBreakdown,
	loadTopAuthors,
	loadTopDiscussions
} from './discussions.js';
