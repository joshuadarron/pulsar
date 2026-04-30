#!/usr/bin/env node
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { initFromConfig } from './init-from-config.js';
import { initInteractive } from './init-interactive.js';

type ParsedArgs = {
	command: string;
	configPath: string | null;
	reconfigure: boolean;
};

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const cwd = process.cwd();

	if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
		printUsage();
		return;
	}

	if (args.command !== 'init' && args.command !== 'setup') {
		console.error(`Unknown command: ${args.command}`);
		printUsage();
		process.exitCode = 1;
		return;
	}

	const voiceDir = path.join(cwd, '.voice');
	const contextDir = path.join(cwd, '.context');
	const alreadyConfigured = existsSync(voiceDir) && existsSync(contextDir);

	if (alreadyConfigured && !args.reconfigure) {
		console.log('Pulsar already configured. Run pnpm setup --reconfigure to reset.');
		return;
	}

	if (args.reconfigure) {
		safeRemove(voiceDir);
		safeRemove(contextDir);
	}

	if (args.configPath) {
		const result = initFromConfig({ cwd, configPath: args.configPath });
		console.log(`Wrote ${result.files.length} files to .voice/ and .context/`);
		return;
	}

	if (!process.stdout.isTTY) {
		console.error(
			'Cannot run interactive setup without a TTY. Pass --from-config <path> for non-interactive setup.'
		);
		process.exitCode = 1;
		return;
	}

	try {
		const result = await initInteractive({ cwd });
		console.log(`Wrote ${result.files.length} files to .voice/ and .context/`);
	} catch (err) {
		if (isExitPromptError(err)) {
			console.error('Setup cancelled.');
			process.exitCode = 1;
			return;
		}
		throw err;
	}
}

function parseArgs(argv: string[]): ParsedArgs {
	const out: ParsedArgs = {
		command: argv[0] ?? 'help',
		configPath: null,
		reconfigure: false
	};
	for (let i = 1; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--from-config') {
			const next = argv[i + 1];
			if (!next) {
				throw new Error('--from-config requires a path argument');
			}
			out.configPath = next;
			i += 1;
		} else if (arg === '--reconfigure') {
			out.reconfigure = true;
		}
	}
	return out;
}

function safeRemove(dir: string): void {
	if (existsSync(dir)) {
		rmSync(dir, { recursive: true, force: true });
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

function printUsage(): void {
	console.log(`Usage:
  pulsar init                         Interactive setup (default in TTY)
  pulsar init --from-config <path>    Non-interactive setup from a YAML file
  pulsar setup                        Alias for pulsar init
  pulsar <cmd> --reconfigure          Wipe .voice/ and .context/ before re-running

Notes:
  - Existing .voice/ and .context/ are preserved unless --reconfigure is passed.
  - Run pnpm setup if the postinstall hook was skipped.`);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
