import { createHash } from 'node:crypto';
import { query } from '@pulsar/shared/db/postgres';

export function hashUrl(url: string): string {
	return createHash('sha256').update(url.trim().toLowerCase()).digest('hex');
}

export async function exists(urlHash: string): Promise<boolean> {
	const result = await query('SELECT 1 FROM articles_raw WHERE url_hash = $1 LIMIT 1', [urlHash]);
	return result.rowCount! > 0;
}
