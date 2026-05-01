import { query } from '@pulsar/shared/db/postgres';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Lists content drafts, optionally filtered by `platform`, `status`, or
 * `reportId`. Returns the post-Phase-5 row shape, including `angle`,
 * `opportunity_signal`, and `metadata`.
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const platform = searchParams.get('platform');
	const status = searchParams.get('status');
	const reportId = searchParams.get('reportId');

	let sql = `SELECT
		id,
		run_id,
		report_id,
		platform,
		content_type,
		body,
		status,
		angle,
		opportunity_signal,
		metadata,
		created_at,
		updated_at
	FROM content_drafts`;
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
	if (reportId) {
		conditions.push(`report_id = $${conditions.length + 1}`);
		values.push(reportId);
	}

	if (conditions.length > 0) {
		sql += ` WHERE ${conditions.join(' AND ')}`;
	}

	sql += ' ORDER BY created_at DESC';

	const result = await query(sql, values);
	return NextResponse.json(result.rows);
}
