import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), '../../../.env') });

import { closeDriver } from '@pulsar/shared/db/neo4j';
import pool from '@pulsar/shared/db/postgres';
import { disconnectClient } from './lib/rocketride.js';
import { runAllPipelines, runContentDraftsForReport } from './runner.js';

interface CliFlags {
	contentOnly: boolean;
	reportId: string | null;
	trigger: 'scheduled' | 'manual';
	help: boolean;
}

export function parseCliArgs(argv: string[]): CliFlags {
	const flags: CliFlags = {
		contentOnly: false,
		reportId: null,
		trigger: 'manual',
		help: false
	};
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			flags.help = true;
		} else if (arg === '--scheduled') {
			flags.trigger = 'scheduled';
		} else if (arg === '--content-only') {
			flags.contentOnly = true;
		} else if (arg.startsWith('--report-id=')) {
			flags.reportId = arg.slice('--report-id='.length);
		}
	}
	return flags;
}

const USAGE = `Usage: pnpm run pipeline [options]

Options:
  --scheduled                 Mark this run as a scheduled trigger (default: manual)
  --content-only              Skip the trend-report pass and only run content drafts
  --report-id=<uuid>          Required with --content-only: target an existing report row
  -h, --help                  Show this help text

Examples:
  pnpm run pipeline
  pnpm run pipeline -- --content-only --report-id=4f9c1e3b-...
`;

async function main() {
	const flags = parseCliArgs(process.argv.slice(2));

	if (flags.help) {
		console.log(USAGE);
		return;
	}

	if (flags.contentOnly && !flags.reportId) {
		console.error('Error: --content-only requires --report-id=<uuid>.\n');
		console.error(USAGE);
		process.exit(1);
	}

	if (!flags.contentOnly && flags.reportId) {
		console.error('Error: --report-id is only valid with --content-only.\n');
		console.error(USAGE);
		process.exit(1);
	}

	try {
		if (flags.contentOnly && flags.reportId) {
			const result = await runContentDraftsForReport(flags.reportId, flags.trigger);
			console.log(
				`[Pipeline] Content-only run complete: runId=${result.runId} draftCount=${result.draftCount}`
			);
		} else {
			await runAllPipelines(flags.trigger);
		}
	} catch (err) {
		console.error('[Pipeline] Failed:', err);
		process.exit(1);
	} finally {
		await disconnectClient();
		await closeDriver();
		await pool.end();
	}
}

main();
