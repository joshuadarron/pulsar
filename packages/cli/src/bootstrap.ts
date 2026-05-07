import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export type BootstrapStepStatus = 'ok' | 'skipped' | 'failed';

export type BootstrapResult = {
	envCopied: BootstrapStepStatus;
	docker: BootstrapStepStatus;
	postgres: BootstrapStepStatus;
	migrate: BootstrapStepStatus;
};

export type BootstrapLogger = {
	info: (message: string) => void;
	warn: (message: string) => void;
};

const DEFAULT_LOGGER: BootstrapLogger = {
	info: (message) => console.log(message),
	warn: (message) => console.warn(message)
};

export type BootstrapOptions = {
	cwd: string;
	logger?: BootstrapLogger;
	postgresHost?: string;
	postgresPort?: number;
	postgresWaitMs?: number;
	skipDocker?: boolean;
	skipMigrate?: boolean;
};

/**
 * Bring the local environment to a runnable state after `pnpm install` has
 * resolved dependencies and the operator has filled in the interactive setup.
 *
 * Each step is idempotent and best-effort. A failure logs and continues so a
 * missing Docker daemon or an unreachable database never breaks the install.
 * The user can re-run any step manually from the README's "Common commands"
 * table.
 */
export async function runBootstrap(opts: BootstrapOptions): Promise<BootstrapResult> {
	const logger = opts.logger ?? DEFAULT_LOGGER;
	const result: BootstrapResult = {
		envCopied: 'skipped',
		docker: 'skipped',
		postgres: 'skipped',
		migrate: 'skipped'
	};

	logger.info('Bootstrapping local environment...');

	result.envCopied = ensureEnvLocal(opts.cwd, logger);

	if (!opts.skipDocker) {
		result.docker = await bringUpDocker(opts.cwd, logger);
	}

	const host = opts.postgresHost ?? 'localhost';
	const port = opts.postgresPort ?? 5432;
	const timeoutMs = opts.postgresWaitMs ?? 30_000;
	result.postgres = await waitForPostgres(host, port, timeoutMs, logger);

	if (!opts.skipMigrate && result.postgres === 'ok') {
		result.migrate = await runMigrations(opts.cwd, logger);
	} else if (!opts.skipMigrate) {
		logger.warn('Skipping migrations: Postgres did not become reachable.');
	}

	return result;
}

/**
 * Copy `.env.example` to `.env.local` if `.env.local` does not exist. Returns
 * `ok` when a copy was made, `skipped` when the destination already exists,
 * and `failed` if the source is missing or the copy itself errored.
 */
export function ensureEnvLocal(cwd: string, logger: BootstrapLogger): BootstrapStepStatus {
	const target = path.join(cwd, '.env.local');
	if (existsSync(target)) {
		logger.info('.env.local already exists, leaving it untouched.');
		return 'skipped';
	}
	const source = path.join(cwd, '.env.example');
	if (!existsSync(source)) {
		logger.warn('.env.example missing; cannot seed .env.local.');
		return 'failed';
	}
	try {
		copyFileSync(source, target);
		logger.info('Copied .env.example to .env.local. Edit it before pnpm dev.');
		return 'ok';
	} catch (err) {
		logger.warn(`Failed to copy .env.example: ${describeError(err)}`);
		return 'failed';
	}
}

async function bringUpDocker(cwd: string, logger: BootstrapLogger): Promise<BootstrapStepStatus> {
	logger.info('Starting Postgres and Neo4j via Docker Compose...');
	const variants: Array<{ command: string; args: string[] }> = [
		{ command: 'docker', args: ['compose', 'up', '-d'] },
		{ command: 'docker-compose', args: ['up', '-d'] }
	];
	for (const variant of variants) {
		const code = await runProcess(variant.command, variant.args, cwd);
		if (code === 0) {
			return 'ok';
		}
		if (code === 'not-found') continue;
		logger.warn(`docker compose exited with code ${code}; continuing.`);
		return 'failed';
	}
	logger.warn(
		'Docker Compose not found on PATH. Install Docker or run docker compose up -d manually.'
	);
	return 'failed';
}

/**
 * Poll a TCP socket against the Postgres host until it accepts a connection or
 * the timeout elapses. We do not run a real protocol handshake here; a TCP
 * accept is sufficient evidence that the container is up enough for the
 * migrate script to do the rest.
 */
export async function waitForPostgres(
	host: string,
	port: number,
	timeoutMs: number,
	logger: BootstrapLogger
): Promise<BootstrapStepStatus> {
	const deadline = Date.now() + timeoutMs;
	const probeIntervalMs = 1000;
	logger.info(`Waiting for Postgres at ${host}:${port}...`);
	while (Date.now() < deadline) {
		if (await tcpProbe(host, port, 1500)) {
			logger.info('Postgres is accepting connections.');
			return 'ok';
		}
		await sleep(probeIntervalMs);
	}
	logger.warn(`Postgres did not become reachable within ${Math.round(timeoutMs / 1000)}s.`);
	return 'failed';
}

async function runMigrations(cwd: string, logger: BootstrapLogger): Promise<BootstrapStepStatus> {
	logger.info('Running database migrations...');
	const code = await runProcess('pnpm', ['--filter', '@pulsar/shared', 'db:migrate'], cwd);
	if (code === 0) return 'ok';
	if (code === 'not-found') {
		logger.warn('pnpm not found on PATH; skipping migrations.');
		return 'failed';
	}
	logger.warn(`Migrations exited with code ${code}; run pnpm run db:migrate manually to retry.`);
	return 'failed';
}

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		let settled = false;
		const finish = (ok: boolean) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(ok);
		};
		socket.setTimeout(timeoutMs);
		socket.once('connect', () => finish(true));
		socket.once('timeout', () => finish(false));
		socket.once('error', () => finish(false));
		socket.connect(port, host);
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spawn a child process with stdio inherited so the user sees real-time
 * output. Returns the exit code, or the literal `'not-found'` if the binary
 * cannot be located on PATH (so the caller can try a fallback variant).
 */
function runProcess(command: string, args: string[], cwd: string): Promise<number | 'not-found'> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd, stdio: 'inherit' });
		let resolved = false;
		const settle = (value: number | 'not-found') => {
			if (resolved) return;
			resolved = true;
			resolve(value);
		};
		child.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'ENOENT') settle('not-found');
			else settle(1);
		});
		child.on('exit', (code) => settle(code ?? 1));
	});
}

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
