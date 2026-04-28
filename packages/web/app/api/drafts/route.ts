import { type NextRequest, NextResponse } from 'next/server';
import { query } from '@pulsar/shared/db/postgres';

export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const platform = searchParams.get('platform');
	const status = searchParams.get('status');

	let sql = 'SELECT * FROM content_drafts';
	const conditions: string[] = [];
	const values: unknown[] = [];

	if (platform) {
		conditions.push(`platform = $${conditions.length + 1}`);
		values.push(platform);
	}
	if (status) {
		conditions.push(`status = $${conditions.length + 1}`);
		values.push(status);
	}

	if (conditions.length > 0) {
		sql += ` WHERE ${conditions.join(' AND ')}`;
	}

	sql += ' ORDER BY created_at DESC';

	const result = await query(sql, values);
	return NextResponse.json(result.rows);
}
