import { query } from './db/postgres';

export type LogLevel = 'info' | 'warn' | 'error' | 'success';

/**
 * Insert a run_logs row. The optional `source` arg attributes the entry to
 * Pulsar's own logging (default) or to a forwarded RocketRide event so the
 * run-detail UI can filter and color-code rows.
 */
export async function logRun(
	runId: string,
	level: LogLevel,
	stage: string,
	message: string,
	source: 'pulsar' | 'rocketride' = 'pulsar'
) {
	const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '';
	console.log(`[Run ${runId}] [${stage}] ${prefix} ${message}`);
	await query(
		'INSERT INTO run_logs (run_id, level, stage, message, source) VALUES ($1, $2, $3, $4, $5)',
		[runId, level, stage, message, source]
	);
}
