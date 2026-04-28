import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), '../../../.env') });

import { scrape } from './index.js';
import { closeDriver } from '@pulsar/shared/db/neo4j';
import pool from '@pulsar/shared/db/postgres';

const args = process.argv.slice(2);
let sourceFilter: string | undefined;
for (const arg of args) {
	if (arg.startsWith('--source=')) {
		sourceFilter = arg.split('=')[1];
	}
}

scrape(sourceFilter)
	.catch((err) => {
		console.error('Fatal scrape error:', err);
		process.exit(1);
	})
	.finally(async () => {
		await closeDriver();
		await pool.end();
	});
