import { type NextRequest, NextResponse } from 'next/server';
import { query } from '@pulsar/shared/db/postgres';

const SORTABLE_COLUMNS = new Set([
	'started_at',
	'completed_at',
	'status',
	'trigger',
	'run_type',
	'articles_scraped',
	'articles_new'
]);

export async function GET(request: NextRequest) {
	const url = request.nextUrl;
	const page = Number.parseInt(url.searchParams.get('page') || '1');
	const limit = Number.parseInt(url.searchParams.get('limit') || '20');
	const offset = (page - 1) * limit;
	const sortBy = url.searchParams.get('sort') || 'started_at';
	const order = url.searchParams.get('order') === 'asc' ? 'ASC' : 'DESC';

	const column = SORTABLE_COLUMNS.has(sortBy) ? sortBy : 'started_at';

	const [runsRes, countRes] = await Promise.all([
		query(`SELECT * FROM runs ORDER BY ${column} ${order} NULLS LAST LIMIT $1 OFFSET $2`, [
			limit,
			offset
		]),
		query<{ count: string }>('SELECT count(*) FROM runs')
	]);

	return NextResponse.json({
		runs: runsRes.rows,
		total: Number.parseInt(countRes.rows[0].count),
		page,
		limit
	});
}
