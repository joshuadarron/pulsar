import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ensureEnvLocal, waitForPostgres } from '../src/bootstrap.js';

type Logger = { info: (m: string) => void; warn: (m: string) => void };

function makeLogger(): { logger: Logger; infos: string[]; warns: string[] } {
	const infos: string[] = [];
	const warns: string[] = [];
	return {
		logger: {
			info: (m) => infos.push(m),
			warn: (m) => warns.push(m)
		},
		infos,
		warns
	};
}

describe('ensureEnvLocal', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), 'pulsar-bootstrap-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('copies .env.example to .env.local when the destination is missing', () => {
		writeFileSync(path.join(tmp, '.env.example'), 'POSTGRES_HOST=localhost\n');
		const { logger } = makeLogger();
		const status = ensureEnvLocal(tmp, logger);
		assert.equal(status, 'ok');
		assert.equal(readFileSync(path.join(tmp, '.env.local'), 'utf8'), 'POSTGRES_HOST=localhost\n');
	});

	it('leaves an existing .env.local untouched', () => {
		writeFileSync(path.join(tmp, '.env.example'), 'NEW=1\n');
		writeFileSync(path.join(tmp, '.env.local'), 'EXISTING=1\n');
		const { logger } = makeLogger();
		const status = ensureEnvLocal(tmp, logger);
		assert.equal(status, 'skipped');
		assert.equal(readFileSync(path.join(tmp, '.env.local'), 'utf8'), 'EXISTING=1\n');
	});

	it('returns failed when .env.example is missing', () => {
		const { logger, warns } = makeLogger();
		const status = ensureEnvLocal(tmp, logger);
		assert.equal(status, 'failed');
		assert.ok(
			warns.some((line) => line.includes('.env.example missing')),
			`expected missing-env warn; got ${warns.join(' | ')}`
		);
	});
});

describe('waitForPostgres', () => {
	it('returns failed quickly when nothing is listening on the port', async () => {
		const { logger, warns } = makeLogger();
		// Port 1 is reserved and never listening; the loop should exhaust the
		// short timeout and return a failed status without throwing.
		const start = Date.now();
		const status = await waitForPostgres('127.0.0.1', 1, 100, logger);
		const elapsed = Date.now() - start;
		assert.equal(status, 'failed');
		assert.ok(elapsed < 5_000, `unexpectedly slow: ${elapsed}ms`);
		assert.ok(warns.some((line) => line.includes('did not become reachable')));
	});
});
