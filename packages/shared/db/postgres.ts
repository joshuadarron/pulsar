import pg from 'pg';
import { env } from '../config/env';

const pool = new pg.Pool({
	host: env.postgres.host,
	port: env.postgres.port,
	database: env.postgres.database,
	user: env.postgres.user,
	password: env.postgres.password,
	max: 20,
	idleTimeoutMillis: 30000
});

// pg.Pool emits 'error' on idle clients whose socket dies (docker bounce,
// macOS sleep, network blip). Without this listener the error is fatal to
// any process holding the pool. The pool itself discards the bad client
// and creates a fresh one on the next acquire, so logging is sufficient.
pool.on('error', (err: Error & { code?: string }) => {
	process.stderr.write(
		`${JSON.stringify({
			ts: new Date().toISOString(),
			level: 'error',
			component: 'pg-pool',
			message: 'idle-client-error',
			code: err.code,
			errorMessage: err.message
		})}\n`
	);
});

export async function query<T extends pg.QueryResultRow = Record<string, unknown>>(
	text: string,
	params?: unknown[]
): Promise<pg.QueryResult<T>> {
	return pool.query<T>(text, params);
}

export async function getClient() {
	return pool.connect();
}

export default pool;
