/**
 * Mapping from backfill adapter key (the key used to look up a Strategy in
 * `strategies/index.ts`) to the `sourcePlatform` values that the corresponding
 * live source adapters write into `articles_raw.raw_payload`.
 *
 * `articles_raw.source_name` stores display names (`"Hacker News"`, `"r/golang"`,
 * `"Medium/devops"`, `"arXiv:cs.AI"`) that do not match the adapter key, so any
 * query that needs to relate live articles to a backfill strategy must join on
 * platform rather than source_name.
 *
 * The 'rss' adapter emits both 'rss' and 'substack' platforms, so its entry
 * fans out.
 */
export const BACKFILL_PLATFORMS: Record<string, string[]> = {
	arxiv: ['arxiv'],
	devto: ['devto'],
	github: ['github'],
	hackernews: ['hackernews'],
	hashnode: ['hashnode'],
	medium: ['medium'],
	reddit: ['reddit'],
	rss: ['rss', 'substack']
};

/** All known backfill adapter keys. */
export const BACKFILL_ADAPTER_KEYS: readonly string[] = Object.keys(BACKFILL_PLATFORMS);
