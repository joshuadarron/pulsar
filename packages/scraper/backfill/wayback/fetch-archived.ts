import { readHtmlCache, writeHtmlCache } from './cache.js';
import {
	type CdxEntry,
	WaybackHttpError,
	WaybackRateLimitError,
	applyRateLimit,
	withRetryOn5xx
} from './cdx.js';

const DEFAULT_RATE_LIMIT_MS = 2000;
const DEFAULT_USER_AGENT = 'Pulsar-Backfill/0.1 (+https://github.com/joshuadarron/pulsar)';
const BLOCKED_BY_ROBOTS_MARKER = /blocked by the site owner|excluded from the wayback machine/i;

export type FetchArchivedOptions = {
	rateLimitMs?: number;
	cacheDir?: string;
	userAgent?: string;
};

/**
 * Build the Wayback playback URL using the `id_` flag, which serves the
 * archived response without the Wayback toolbar or rewriter.
 */
export function buildArchivedHtmlUrl(timestamp: string, originalUrl: string): string {
	return `https://web.archive.org/web/${timestamp}id_/${originalUrl}`;
}

async function fetchArchivedOnce(url: string, userAgent: string): Promise<string | null> {
	const response = await fetch(url, {
		headers: {
			'User-Agent': userAgent,
			Accept: 'text/html,application/xhtml+xml,*/*'
		}
	});

	if (response.status === 429) {
		throw new WaybackRateLimitError();
	}
	if (response.status === 404) {
		return null;
	}
	if (response.status >= 500) {
		throw new WaybackHttpError(response.status, `Wayback playback HTTP ${response.status}`);
	}
	if (!response.ok) {
		throw new WaybackHttpError(response.status, `Wayback playback HTTP ${response.status}`);
	}

	const body = await response.text();
	if (BLOCKED_BY_ROBOTS_MARKER.test(body)) {
		return null;
	}
	return body;
}

/**
 * Fetch the archived HTML for a single CDX entry. Returns the body string,
 * or null if Wayback returned 404 or a robots/blocked response. Cached on
 * disk under `<cacheDir>/html/<timestamp>-<sha256>.html` for 30 days.
 */
export async function fetchArchivedHtml(
	entry: CdxEntry,
	options: FetchArchivedOptions = {}
): Promise<string | null> {
	const cached = await readHtmlCache(entry.timestamp, entry.originalUrl, {
		cacheDir: options.cacheDir
	});
	if (cached !== null) return cached;

	const url = buildArchivedHtmlUrl(entry.timestamp, entry.originalUrl);
	const rateLimitMs = options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
	const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

	const html = await withRetryOn5xx(async () => {
		await applyRateLimit(rateLimitMs);
		return fetchArchivedOnce(url, userAgent);
	});

	if (html === null) return null;
	await writeHtmlCache(entry.timestamp, entry.originalUrl, html, {
		cacheDir: options.cacheDir
	});
	return html;
}
