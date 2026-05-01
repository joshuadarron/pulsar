import { readCdxCache, writeCdxCache } from './cache.js';

const CDX_ENDPOINT = 'http://web.archive.org/cdx/search/cdx';
const DEFAULT_RATE_LIMIT_MS = 2000;
const DEFAULT_USER_AGENT = 'Pulsar-Backfill/0.1 (+https://github.com/joshuadarron/pulsar)';

export type CdxEntry = {
	urlkey: string;
	timestamp: string;
	originalUrl: string;
	mimetype: string;
	statusCode: number;
	digest: string;
	length: number;
};

export type CdxQueryOptions = {
	rateLimitMs?: number;
	cacheDir?: string;
	userAgent?: string;
};

export class WaybackRateLimitError extends Error {
	readonly status = 429;

	constructor(message = 'Wayback returned HTTP 429 (rate limited)') {
		super(message);
		this.name = 'WaybackRateLimitError';
	}
}

export class WaybackHttpError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'WaybackHttpError';
		this.status = status;
	}
}

let lastRequestAt = 0;

export function __resetRateLimiterForTesting(): void {
	lastRequestAt = 0;
}

async function sleep(ms: number): Promise<void> {
	if (ms <= 0) return;
	await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function applyRateLimit(rateLimitMs: number): Promise<void> {
	const now = Date.now();
	const elapsed = now - lastRequestAt;
	const wait = rateLimitMs - elapsed;
	if (wait > 0) {
		await sleep(wait);
	}
	lastRequestAt = Date.now();
}

function formatTimestamp(date: Date): string {
	const pad = (n: number, len = 2) => String(n).padStart(len, '0');
	const year = date.getUTCFullYear();
	const month = pad(date.getUTCMonth() + 1);
	const day = pad(date.getUTCDate());
	const hour = pad(date.getUTCHours());
	const minute = pad(date.getUTCMinutes());
	const second = pad(date.getUTCSeconds());
	return `${year}${month}${day}${hour}${minute}${second}`;
}

export function buildCdxQueryUrl(urlPattern: string, windowStart: Date, windowEnd: Date): string {
	const params = new URLSearchParams({
		url: urlPattern,
		from: formatTimestamp(windowStart),
		to: formatTimestamp(windowEnd),
		output: 'json',
		collapse: 'urlkey'
	});
	params.append('filter', 'statuscode:200');
	params.append('filter', 'mimetype:text/html');
	return `${CDX_ENDPOINT}?${params.toString()}`;
}

type RawCdxRow = string[];
type RawCdxResponse = RawCdxRow[];

export function parseCdxResponse(payload: RawCdxResponse): CdxEntry[] {
	if (!Array.isArray(payload) || payload.length <= 1) return [];
	const [header, ...rows] = payload;
	const idx = (name: string) => header.indexOf(name);
	const urlkeyIdx = idx('urlkey');
	const timestampIdx = idx('timestamp');
	const originalIdx = idx('original');
	const mimeIdx = idx('mimetype');
	const statusIdx = idx('statuscode');
	const digestIdx = idx('digest');
	const lengthIdx = idx('length');

	return rows.map((row) => ({
		urlkey: urlkeyIdx >= 0 ? row[urlkeyIdx] : '',
		timestamp: timestampIdx >= 0 ? row[timestampIdx] : '',
		originalUrl: originalIdx >= 0 ? row[originalIdx] : '',
		mimetype: mimeIdx >= 0 ? row[mimeIdx] : '',
		statusCode: statusIdx >= 0 ? Number(row[statusIdx]) : 0,
		digest: digestIdx >= 0 ? row[digestIdx] : '',
		length: lengthIdx >= 0 ? Number(row[lengthIdx]) : 0
	}));
}

async function fetchCdxOnce(url: string, userAgent: string): Promise<RawCdxResponse> {
	const response = await fetch(url, {
		headers: {
			'User-Agent': userAgent,
			Accept: 'application/json'
		}
	});

	if (response.status === 429) {
		throw new WaybackRateLimitError();
	}
	if (response.status >= 500) {
		throw new WaybackHttpError(response.status, `Wayback CDX HTTP ${response.status}`);
	}
	if (response.status === 404) {
		return [];
	}
	if (!response.ok) {
		throw new WaybackHttpError(response.status, `Wayback CDX HTTP ${response.status}`);
	}

	const text = await response.text();
	if (!text.trim()) return [];
	try {
		return JSON.parse(text) as RawCdxResponse;
	} catch (err) {
		throw new WaybackHttpError(
			response.status,
			`Failed to parse CDX JSON: ${(err as Error).message}`
		);
	}
}

/**
 * Query the Wayback CDX index for snapshots of a URL pattern within a window.
 * Results are deduplicated by urlkey via the CDX `collapse=urlkey` flag, which
 * keeps the first encountered snapshot per unique page in the window.
 * Cached on disk under `<cacheDir>/cdx/<sha256>.json` for 30 days.
 */
export async function queryCdx(
	urlPattern: string,
	windowStart: Date,
	windowEnd: Date,
	options: CdxQueryOptions = {}
): Promise<CdxEntry[]> {
	const url = buildCdxQueryUrl(urlPattern, windowStart, windowEnd);
	const cacheKey = url;

	const cached = await readCdxCache<RawCdxResponse>(cacheKey, { cacheDir: options.cacheDir });
	if (cached) {
		return parseCdxResponse(cached);
	}

	const rateLimitMs = options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
	const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

	const raw = await withRetryOn5xx(async () => {
		await applyRateLimit(rateLimitMs);
		return fetchCdxOnce(url, userAgent);
	});

	await writeCdxCache(cacheKey, raw, { cacheDir: options.cacheDir });
	return parseCdxResponse(raw);
}

/**
 * Retries the supplied async function up to `maxAttempts` times with
 * exponential backoff, but only when the error is a 5xx WaybackHttpError.
 * Any other error (including WaybackRateLimitError and 4xx) propagates
 * immediately so the caller can handle it.
 */
export async function withRetryOn5xx<T>(
	fn: () => Promise<T>,
	maxAttempts = 3,
	baseDelayMs = 1000
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			const retriable = err instanceof WaybackHttpError && err.status >= 500;
			if (!retriable || attempt === maxAttempts) throw err;
			const delay = baseDelayMs * 2 ** (attempt - 1);
			await sleep(delay);
		}
	}
	throw lastError;
}
