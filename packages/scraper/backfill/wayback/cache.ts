import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CACHE_DIR = '.cache/wayback';
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CacheNamespace = 'cdx' | 'html';

export type CacheOptions = {
	cacheDir?: string;
	ttlMs?: number;
};

function isCacheDisabled(): boolean {
	return process.env.WAYBACK_CACHE_DISABLE === 'true';
}

function resolveCacheRoot(cacheDir?: string): string {
	const dir = cacheDir ?? DEFAULT_CACHE_DIR;
	return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

export function hashKey(input: string): string {
	return createHash('sha256').update(input).digest('hex');
}

export function cdxCachePath(queryKey: string, options: CacheOptions = {}): string {
	const root = resolveCacheRoot(options.cacheDir);
	return path.join(root, 'cdx', `${hashKey(queryKey)}.json`);
}

export function htmlCachePath(
	timestamp: string,
	originalUrl: string,
	options: CacheOptions = {}
): string {
	const root = resolveCacheRoot(options.cacheDir);
	return path.join(root, 'html', `${timestamp}-${hashKey(originalUrl)}.html`);
}

async function isFresh(filePath: string, ttlMs: number): Promise<boolean> {
	try {
		const info = await stat(filePath);
		const age = Date.now() - info.mtimeMs;
		return age <= ttlMs;
	} catch {
		return false;
	}
}

export async function readCacheFile(
	filePath: string,
	options: CacheOptions = {}
): Promise<string | null> {
	if (isCacheDisabled()) return null;
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	const fresh = await isFresh(filePath, ttlMs);
	if (!fresh) return null;
	try {
		return await readFile(filePath, 'utf8');
	} catch {
		return null;
	}
}

export async function writeCacheFile(filePath: string, contents: string): Promise<void> {
	if (isCacheDisabled()) return;
	const dir = path.dirname(filePath);
	await mkdir(dir, { recursive: true });
	const tmpPath = `${filePath}.tmp`;
	await writeFile(tmpPath, contents, 'utf8');
	await rename(tmpPath, filePath);
}

export async function readCdxCache<T>(
	queryKey: string,
	options: CacheOptions = {}
): Promise<T | null> {
	const filePath = cdxCachePath(queryKey, options);
	const raw = await readCacheFile(filePath, options);
	if (raw === null) return null;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

export async function writeCdxCache(
	queryKey: string,
	value: unknown,
	options: CacheOptions = {}
): Promise<void> {
	const filePath = cdxCachePath(queryKey, options);
	await writeCacheFile(filePath, JSON.stringify(value));
}

export async function readHtmlCache(
	timestamp: string,
	originalUrl: string,
	options: CacheOptions = {}
): Promise<string | null> {
	const filePath = htmlCachePath(timestamp, originalUrl, options);
	return readCacheFile(filePath, options);
}

export async function writeHtmlCache(
	timestamp: string,
	originalUrl: string,
	html: string,
	options: CacheOptions = {}
): Promise<void> {
	const filePath = htmlCachePath(timestamp, originalUrl, options);
	await writeCacheFile(filePath, html);
}
