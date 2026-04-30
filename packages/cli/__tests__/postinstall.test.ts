import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

process.env.PULSAR_CLI_SKIP_AUTORUN = '1';

type InitFn = (opts: { cwd: string }) => Promise<{
	voiceDir: string;
	contextDir: string;
	files: string[];
}>;

const initSpy = mock.fn<InitFn>(async () => ({
	voiceDir: '/tmp/.voice',
	contextDir: '/tmp/.context',
	files: ['a.md', 'b.md', 'c.md']
}));

mock.module('../src/init-interactive.js', {
	namedExports: {
		initInteractive: initSpy
	}
});

const { runPostinstall } = await import('../src/postinstall.js');

describe('runPostinstall', () => {
	let tmp: string;
	let logs: string[];
	let errors: string[];
	let originalLog: typeof console.log;
	let originalError: typeof console.error;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), 'pulsar-postinstall-'));
		logs = [];
		errors = [];
		originalLog = console.log;
		originalError = console.error;
		console.log = (msg: unknown) => {
			logs.push(String(msg));
		};
		console.error = (msg: unknown) => {
			errors.push(String(msg));
		};
		initSpy.mock.resetCalls();
	});

	afterEach(() => {
		console.log = originalLog;
		console.error = originalError;
		rmSync(tmp, { recursive: true, force: true });
	});

	describe('skip guards', () => {
		it('skips when stdout is not a TTY', async () => {
			const result = await runPostinstall({
				cwd: tmp,
				isTTY: false,
				initCwd: tmp
			});
			assert.deepEqual(result, { action: 'skipped-non-tty' });
			assert.equal(initSpy.mock.callCount(), 0);
			assert.ok(
				logs.some((line) => line.includes('Pulsar setup skipped (non-interactive environment)')),
				`expected skip log; got ${logs.join(' | ')}`
			);
		});

		it('skips silently when INIT_CWD differs from cwd (transitive install)', async () => {
			const otherCwd = mkdtempSync(path.join(tmpdir(), 'other-cwd-'));
			try {
				const result = await runPostinstall({
					cwd: tmp,
					isTTY: true,
					initCwd: otherCwd
				});
				assert.deepEqual(result, { action: 'skipped-transitive' });
				assert.equal(initSpy.mock.callCount(), 0);
				assert.equal(logs.length, 0);
				assert.equal(errors.length, 0);
			} finally {
				rmSync(otherCwd, { recursive: true, force: true });
			}
		});

		it('skips with already-configured message when both .voice and .context exist', async () => {
			mkdirSync(path.join(tmp, '.voice'));
			mkdirSync(path.join(tmp, '.context'));
			const result = await runPostinstall({
				cwd: tmp,
				isTTY: true,
				initCwd: tmp
			});
			assert.deepEqual(result, { action: 'skipped-configured' });
			assert.equal(initSpy.mock.callCount(), 0);
			assert.ok(
				logs.some((line) => line.includes('Pulsar already configured')),
				`expected configured log; got ${logs.join(' | ')}`
			);
		});

		it('does not skip when only .voice exists but .context does not', async () => {
			mkdirSync(path.join(tmp, '.voice'));
			const result = await runPostinstall({
				cwd: tmp,
				isTTY: true,
				initCwd: tmp
			});
			assert.equal(result.action, 'configured');
			assert.equal(initSpy.mock.callCount(), 1);
		});
	});

	describe('successful path', () => {
		it('invokes the interactive flow and reports file count', async () => {
			const result = await runPostinstall({
				cwd: tmp,
				isTTY: true,
				initCwd: tmp
			});
			assert.deepEqual(result, { action: 'configured', filesWritten: 3 });
			assert.equal(initSpy.mock.callCount(), 1);
		});

		it('passes the cwd to the interactive flow', async () => {
			await runPostinstall({
				cwd: tmp,
				isTTY: true,
				initCwd: tmp
			});
			const callArg = initSpy.mock.calls[0]?.arguments[0];
			assert.equal(callArg?.cwd, tmp);
		});
	});

	describe('failure handling', () => {
		it('reports cancelled when interactive flow throws ExitPromptError', async () => {
			initSpy.mock.mockImplementationOnce(async () => {
				const err = new Error('User cancelled');
				err.name = 'ExitPromptError';
				throw err;
			});
			const result = await runPostinstall({
				cwd: tmp,
				isTTY: true,
				initCwd: tmp
			});
			assert.deepEqual(result, { action: 'cancelled' });
			assert.ok(errors.some((line) => line.includes('cancelled')));
		});

		it('reports error when interactive flow throws unexpectedly', async () => {
			initSpy.mock.mockImplementationOnce(async () => {
				throw new Error('boom');
			});
			const result = await runPostinstall({
				cwd: tmp,
				isTTY: true,
				initCwd: tmp
			});
			assert.equal(result.action, 'error');
			if (result.action === 'error') {
				assert.equal(result.message, 'boom');
			}
			assert.ok(errors.some((line) => line.includes('Pulsar setup failed')));
		});
	});
});
