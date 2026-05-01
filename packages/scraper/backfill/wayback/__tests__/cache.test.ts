import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
	cdxCachePath,
	hashKey,
	htmlCachePath,
	readCacheFile,
	readCdxCache,
	readHtmlCache,
	writeCacheFile,
	writeCdxCache,
	writeHtmlCache
} from '../cache.js';

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(path.join(tmpdir(), 'wayback-cache-test-'));
	// biome-ignore lint/performance/noDelete: must remove env var, not stringify undefined
	delete process.env.WAYBACK_CACHE_DISABLE;
});

afterEach(async () => {
	// biome-ignore lint/performance/noDelete: must remove env var, not stringify undefined
	delete process.env.WAYBACK_CACHE_DISABLE;
	await rm(tempDir, { recursive: true, force: true });
});

describe('hashKey', () => {
	it('returns a 64-char hex sha256 digest', () => {
		const hash = hashKey('hello world');
		assert.match(hash, /^[a-f0-9]{64}$/);
	});

	it('is deterministic for the same input', () => {
		assert.equal(hashKey('foo'), hashKey('foo'));
	});
});

describe('cdxCachePath', () => {
	it('places the file under <cacheDir>/cdx/<sha256>.json', () => {
		const p = cdxCachePath('https://example.com', { cacheDir: tempDir });
		assert.ok(p.startsWith(path.join(tempDir, 'cdx')));
		assert.ok(p.endsWith('.json'));
	});
});

describe('htmlCachePath', () => {
	it('encodes timestamp and original URL hash into the file name', () => {
		const p = htmlCachePath('20230101000000', 'https://example.com/a', { cacheDir: tempDir });
		assert.ok(p.startsWith(path.join(tempDir, 'html')));
		assert.ok(path.basename(p).startsWith('20230101000000-'));
		assert.ok(p.endsWith('.html'));
	});
});

describe('writeCacheFile + readCacheFile', () => {
	describe('happy path', () => {
		it('writes atomically via .tmp rename and reads the value back', async () => {
			const filePath = path.join(tempDir, 'cdx', 'sample.json');
			await writeCacheFile(filePath, '{"ok":1}');

			const onDisk = await readFile(filePath, 'utf8');
			assert.equal(onDisk, '{"ok":1}');

			const result = await readCacheFile(filePath);
			assert.equal(result, '{"ok":1}');
		});

		it('returns null when the file does not exist', async () => {
			const result = await readCacheFile(path.join(tempDir, 'missing.json'));
			assert.equal(result, null);
		});
	});

	describe('TTL', () => {
		it('returns null when the file is older than the TTL', async () => {
			const filePath = path.join(tempDir, 'old.json');
			await writeCacheFile(filePath, 'stale');
			const old = new Date(Date.now() - 60 * 1000);
			await utimes(filePath, old, old);

			const result = await readCacheFile(filePath, { ttlMs: 1000 });
			assert.equal(result, null);
		});

		it('returns the cached value when within the TTL', async () => {
			const filePath = path.join(tempDir, 'fresh.json');
			await writeCacheFile(filePath, 'fresh');
			const result = await readCacheFile(filePath, { ttlMs: 60 * 1000 });
			assert.equal(result, 'fresh');
		});
	});

	describe('disabled cache', () => {
		it('reads return null when WAYBACK_CACHE_DISABLE=true', async () => {
			const filePath = path.join(tempDir, 'disabled.json');
			await writeFile(filePath, 'present', 'utf8');

			process.env.WAYBACK_CACHE_DISABLE = 'true';
			const result = await readCacheFile(filePath);
			assert.equal(result, null);
		});

		it('writes are no-ops when WAYBACK_CACHE_DISABLE=true', async () => {
			process.env.WAYBACK_CACHE_DISABLE = 'true';
			const filePath = path.join(tempDir, 'should-not-write.json');
			await writeCacheFile(filePath, 'nope');
			await assert.rejects(() => stat(filePath));
		});
	});
});

describe('CDX cache helpers', () => {
	it('writes and reads JSON-encoded values keyed by query string', async () => {
		const key = 'https://wayback/cdx?url=foo';
		await writeCdxCache(key, [['urlkey', 'timestamp']], { cacheDir: tempDir });
		const round = await readCdxCache<string[][]>(key, { cacheDir: tempDir });
		assert.deepEqual(round, [['urlkey', 'timestamp']]);
	});
});

describe('HTML cache helpers', () => {
	it('writes and reads HTML keyed by timestamp + URL hash', async () => {
		const ts = '20230101000000';
		const url = 'https://example.com/a';
		await writeHtmlCache(ts, url, '<html>hi</html>', { cacheDir: tempDir });
		const round = await readHtmlCache(ts, url, { cacheDir: tempDir });
		assert.equal(round, '<html>hi</html>');
	});
});
