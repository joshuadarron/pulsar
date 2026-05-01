import { arxivStrategy } from './arxiv.js';
import { githubStrategy } from './github.js';
import { hackernewsStrategy } from './hackernews.js';
import { redditStrategy } from './reddit.js';
import type { Strategy } from './types.js';
import { waybackFeedStrategy } from './wayback-feed.js';

export type { Strategy, StrategyContext, StrategyResult } from './types.js';

/**
 * Registry of backfill strategies, keyed by source name. The worker resolves
 * a strategy via `getStrategy(job.source_name)`. To add a source, register a
 * Strategy here. Strategies must not write to the database; they return
 * ScrapedItems with `sourceOrigin` and `backfillRunId` set.
 */
export const strategies: Record<string, Strategy> = {
	arxiv: arxivStrategy,
	hackernews: hackernewsStrategy,
	reddit: redditStrategy,
	github: githubStrategy,
	hashnode: waybackFeedStrategy('hashnode'),
	medium: waybackFeedStrategy('medium'),
	devto: waybackFeedStrategy('devto'),
	rss: waybackFeedStrategy('rss')
};

/**
 * Resolve a strategy by source name. Throws when no strategy is registered;
 * the worker treats this as a permanent job failure (no retry).
 */
export function getStrategy(sourceName: string): Strategy {
	const strategy = strategies[sourceName];
	if (!strategy) {
		throw new Error(`No backfill strategy for source: ${sourceName}`);
	}
	return strategy;
}

export { arxivStrategy, githubStrategy, hackernewsStrategy, redditStrategy, waybackFeedStrategy };
