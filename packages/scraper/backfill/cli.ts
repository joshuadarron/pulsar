import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), '../../../../.env') });

import pool from '@pulsar/shared/db/postgres';

import { enqueueBackfill } from './queue.js';

const VALID_SOURCES = [
	'arxiv',
	'devto',
	'github',
	'hackernews',
	'hashnode',
	'medium',
	'reddit',
	'rss'
];

const USAGE = `Usage: pnpm run backfill -- --source=<name> --from=YYYY-MM-DD --to=YYYY-MM-DD

Options:
  --source=<name>     One of: ${VALID_SOURCES.join(', ')}
  --from=YYYY-MM-DD   Inclusive window start (UTC)
  --to=YYYY-MM-DD     Inclusive window end (UTC)
  --help              Print this message

Example:
  pnpm run backfill -- --source=arxiv --from=2024-01-01 --to=2024-01-07
`;

type ParsedArgs = {
	help: boolean;
	source?: string;
	from?: string;
	to?: string;
};

export function parseArgs(argv: string[]): ParsedArgs {
	const out: ParsedArgs = { help: false };
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			out.help = true;
			continue;
		}
		const match = /^--([a-zA-Z0-9-]+)=(.*)$/.exec(arg);
		if (!match) continue;
		const [, key, value] = match;
		if (key === 'source') out.source = value;
		else if (key === 'from') out.from = value;
		else if (key === 'to') out.to = value;
	}
	return out;
}

export type ValidatedArgs = {
	source: string;
	from: Date;
	to: Date;
};

export class CliValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CliValidationError';
	}
}

function parseIsoDate(label: string, value: string): Date {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new CliValidationError(`Invalid --${label}: expected YYYY-MM-DD, got "${value}"`);
	}
	const date = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) {
		throw new CliValidationError(`Invalid --${label}: not a real date "${value}"`);
	}
	return date;
}

export function validateArgs(args: ParsedArgs): ValidatedArgs {
	if (!args.source) throw new CliValidationError('Missing required --source');
	if (!args.from) throw new CliValidationError('Missing required --from');
	if (!args.to) throw new CliValidationError('Missing required --to');

	if (!VALID_SOURCES.includes(args.source)) {
		throw new CliValidationError(
			`Unknown source "${args.source}". Valid sources: ${VALID_SOURCES.join(', ')}`
		);
	}

	const from = parseIsoDate('from', args.from);
	const to = parseIsoDate('to', args.to);
	if (from.getTime() > to.getTime()) {
		throw new CliValidationError('--from must be on or before --to');
	}
	return { source: args.source, from, to };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		process.stdout.write(USAGE);
		process.exit(0);
	}

	let validated: ValidatedArgs;
	try {
		validated = validateArgs(args);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`${message}\n\n${USAGE}`);
		process.exit(2);
	}

	const { runId, jobId } = await enqueueBackfill(
		pool,
		validated.source,
		validated.from,
		validated.to,
		'manual'
	);

	process.stdout.write(
		`Enqueued backfill run ${runId} (job ${jobId}) for ${validated.source} from ${validated.from.toISOString()} to ${validated.to.toISOString()}.\n`
	);
	process.stdout.write('Run `pnpm run backfill-worker` to process the queue.\n');
	await pool.end();
}

const isEntrypoint = (() => {
	const argv1 = process.argv[1];
	if (!argv1) return false;
	const here = fileURLToPath(import.meta.url);
	return path.resolve(argv1) === path.resolve(here);
})();

if (isEntrypoint) {
	main().catch((err: unknown) => {
		process.stderr.write(
			`backfill CLI fatal: ${err instanceof Error ? err.message : String(err)}\n`
		);
		process.exit(1);
	});
}

export { VALID_SOURCES };
