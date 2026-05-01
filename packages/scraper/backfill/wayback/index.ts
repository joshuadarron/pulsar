import {
	type CdxEntry,
	type CdxQueryOptions,
	WaybackHttpError,
	WaybackRateLimitError,
	queryCdx
} from './cdx.js';
import { type FetchArchivedOptions, fetchArchivedHtml } from './fetch-archived.js';

export { queryCdx, fetchArchivedHtml, WaybackRateLimitError, WaybackHttpError };
export type { CdxEntry };

export type WaybackOptions = CdxQueryOptions & FetchArchivedOptions;

/**
 * Convenience generator: queries the CDX index for the given URL pattern and
 * window, then yields each archived snapshot's HTML body in turn. Each fetch
 * is rate-limited (default 1 request per 2 seconds) and disk-cached.
 *
 * Snapshots that Wayback returns as 404 or robots-blocked are skipped silently.
 */
export async function* streamArchivedHtml(
	urlPattern: string,
	windowStart: Date,
	windowEnd: Date,
	options: WaybackOptions = {}
): AsyncIterable<{ entry: CdxEntry; html: string }> {
	const entries = await queryCdx(urlPattern, windowStart, windowEnd, options);
	for (const entry of entries) {
		const html = await fetchArchivedHtml(entry, options);
		if (html === null) continue;
		yield { entry, html };
	}
}
