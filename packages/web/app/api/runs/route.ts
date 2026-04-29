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

interface SortSpec {
	column: string;
	direction: 'ASC' | 'DESC';
}

const DEFAULT_SORT: SortSpec = { column: 'started_at', direction: 'DESC' };

/**
 * Accept either:
 *   - new multi-column format: ?sort=status:asc,started_at:desc
 *   - legacy single-column format: ?sort=started_at&order=desc
 *
 * Each column is validated against the SORTABLE_COLUMNS allowlist; direction
 * is normalized to ASC/DESC. Both fields are then safe to inline into the
 * ORDER BY clause.
 */
function parseSorts(raw: string | null, legacyOrder: string | null): SortSpec[] {
	if (!raw) return [DEFAULT_SORT];

	const isLegacy = !raw.includes(':') && !raw.includes(',');
	if (isLegacy) {
		const direction = legacyOrder === 'asc' ? 'ASC' : 'DESC';
		const column = SORTABLE_COLUMNS.has(raw) ? raw : DEFAULT_SORT.column;
		return [{ column, direction }];
	}

	const result: SortSpec[] = [];
	for (const part of raw.split(',')) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const [col, dir] = trimmed.split(':');
		if (!SORTABLE_COLUMNS.has(col)) continue;
		const direction = dir?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
		result.push({ column: col, direction });
	}
	return result.length > 0 ? result : [DEFAULT_SORT];
}

export async function GET(request: NextRequest) {
	const url = request.nextUrl;
	const page = Number.parseInt(url.searchParams.get('page') || '1');
	const limit = Number.parseInt(url.searchParams.get('limit') || '20');
	const offset = (page - 1) * limit;

	const sorts = parseSorts(url.searchParams.get('sort'), url.searchParams.get('order'));
	const orderClause = sorts.map((s) => `${s.column} ${s.direction} NULLS LAST`).join(', ');

	const [runsRes, countRes] = await Promise.all([
		query(`SELECT * FROM runs ORDER BY ${orderClause} LIMIT $1 OFFSET $2`, [limit, offset]),
		query<{ count: string }>('SELECT count(*) FROM runs')
	]);

	return NextResponse.json({
		runs: runsRes.rows,
		total: Number.parseInt(countRes.rows[0].count),
		page,
		limit
	});
}
