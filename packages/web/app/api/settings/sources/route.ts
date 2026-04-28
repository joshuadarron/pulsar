import { type NextRequest, NextResponse } from 'next/server';
import { query } from '@pulsar/shared/db/postgres';

/** Returns list of disabled source names. All sources are enabled by default. */
export async function GET() {
	const result = await query<{ value: string }>(
		"SELECT value FROM settings WHERE key = 'disabled_sources'"
	);
	const disabled: string[] = result.rows[0] ? JSON.parse(result.rows[0].value) : [];
	return NextResponse.json({ disabled });
}

/** Set the full list of disabled source names. */
export async function PUT(request: NextRequest) {
	const body = await request.json();
	const { disabled } = body;

	if (!Array.isArray(disabled)) {
		return NextResponse.json(
			{ error: 'disabled must be an array of source names' },
			{ status: 400 }
		);
	}

	await query(
		"INSERT INTO settings (key, value, updated_at) VALUES ('disabled_sources', $1, now()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()",
		[JSON.stringify(disabled)]
	);

	return NextResponse.json({ disabled });
}
