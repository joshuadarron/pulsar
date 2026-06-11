import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), '../../../.env') });

import { closeDriver } from '@pulsar/shared/db/neo4j';
import pool from '@pulsar/shared/db/postgres';
import { runRetrospectiveGrading } from './lib/evals/retrospective.js';
import { disconnectClient } from './lib/rocketride.js';

async function main() {
	try {
		const trigger = process.argv.includes('--scheduled') ? 'scheduled' : 'manual';
		const result = await runRetrospectiveGrading(trigger);
		console.log(
			`[Retrospective] runId=${result.runId} graded=${result.graded} skipped=${result.skipped}`
		);
	} catch (err) {
		console.error('[Retrospective] Failed:', err);
		process.exit(1);
	} finally {
		await disconnectClient();
		await closeDriver();
		await pool.end();
	}
}

main();
