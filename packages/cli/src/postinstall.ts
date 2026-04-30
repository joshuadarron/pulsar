#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initInteractive } from './init-interactive.js';

export type PostinstallResult =
	| { action: 'skipped-non-tty' }
	| { action: 'skipped-transitive' }
	| { action: 'skipped-configured' }
	| { action: 'configured'; filesWritten: number }
	| { action: 'cancelled' }
	| { action: 'error'; message: string };

export type PostinstallEnv = {
	cwd: string;
	isTTY: boolean;
	initCwd: string | undefined;
};

/**
 * Postinstall guard. Runs after `pnpm install` finishes.
 *
 * Skip rules, in order:
 *   1. Non-TTY: log a polite skip message and exit 0.
 *   2. Pulsar installed as a transitive dep: detected when INIT_CWD differs
 *      from process.cwd(). Skip silently. (pnpm sets INIT_CWD to the directory
 *      where the user originally invoked `pnpm install`. When that matches the
 *      package-being-installed cwd, we are at the Pulsar repo root.)
 *   3. Already configured: both .voice/ and .context/ exist. Log and exit 0.
 *
 * Otherwise, hand off to the interactive flow.
 */
export async function runPostinstall(env: PostinstallEnv): Promise<PostinstallResult> {
	if (!env.isTTY) {
		console.log('Pulsar setup skipped (non-interactive environment). Run pnpm setup to configure.');
		return { action: 'skipped-non-tty' };
	}

	if (env.initCwd && path.resolve(env.initCwd) !== path.resolve(env.cwd)) {
		// Installed as a transitive dep, not the Pulsar repo root install.
		return { action: 'skipped-transitive' };
	}

	const voiceDir = path.join(env.cwd, '.voice');
	const contextDir = path.join(env.cwd, '.context');

	if (existsSync(voiceDir) && existsSync(contextDir)) {
		console.log('Pulsar already configured. Run pnpm setup --reconfigure to reset.');
		return { action: 'skipped-configured' };
	}

	try {
		const result = await initInteractive({ cwd: env.cwd });
		console.log(`Wrote ${result.files.length} files to .voice/ and .context/`);
		return { action: 'configured', filesWritten: result.files.length };
	} catch (err) {
		if (isExitPromptError(err)) {
			console.error('Pulsar setup cancelled. Run pnpm setup to retry.');
			return { action: 'cancelled' };
		}
		const message = err instanceof Error ? err.message : String(err);
		console.error('Pulsar setup failed:', message);
		// Do not fail the install. Setup can be re-run manually.
		return { action: 'error', message };
	}
}

function isExitPromptError(err: unknown): boolean {
	return (
		typeof err === 'object' &&
		err !== null &&
		'name' in err &&
		(err as { name: string }).name === 'ExitPromptError'
	);
}

function isMainEntry(): boolean {
	if (process.env.PULSAR_CLI_SKIP_AUTORUN === '1') {
		return false;
	}
	if (!process.argv[1]) {
		return false;
	}
	const thisFile = fileURLToPath(import.meta.url);
	const argvBase = path.basename(process.argv[1]);
	const thisBase = path.basename(thisFile);
	return argvBase === thisBase || path.resolve(process.argv[1]) === path.resolve(thisFile);
}

if (isMainEntry()) {
	runPostinstall({
		cwd: process.cwd(),
		isTTY: Boolean(process.stdout.isTTY),
		initCwd: process.env.INIT_CWD
	}).catch((err) => {
		console.error('Pulsar postinstall error:', err instanceof Error ? err.message : err);
		// Never fail install on postinstall hook errors.
	});
}
