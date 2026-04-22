import { NextRequest, NextResponse } from 'next/server';
import { query } from '@pulsar/shared/db/postgres';

interface ScheduleRow {
	id: string;
	type: string;
	hour: number;
	minute: number;
	days: number[];
	active: boolean;
}

export async function GET() {
	const result = await query<ScheduleRow>(
		'SELECT id, type, hour, minute, days, active FROM schedules ORDER BY type, hour, minute',
	);
	return NextResponse.json({ schedules: result.rows });
}

export async function POST(request: NextRequest) {
	const body = await request.json();
	const { type, hour, minute, days } = body;

	if (!['scrape', 'pipeline'].includes(type)) {
		return NextResponse.json({ error: 'type must be scrape or pipeline' }, { status: 400 });
	}
	if (typeof hour !== 'number' || typeof minute !== 'number' || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
		return NextResponse.json({ error: 'Valid hour (0-23) and minute (0-59) required' }, { status: 400 });
	}
	if (!Array.isArray(days) || days.length === 0 || days.some((d: number) => d < 0 || d > 6)) {
		return NextResponse.json({ error: 'days must be array of 0-6 (Sun-Sat)' }, { status: 400 });
	}

	const result = await query<{ id: string }>(
		'INSERT INTO schedules (type, hour, minute, days) VALUES ($1, $2, $3, $4) RETURNING id',
		[type, hour, minute, days],
	);

	return NextResponse.json({ id: result.rows[0].id });
}

export async function PATCH(request: NextRequest) {
	const body = await request.json();
	const { id, hour, minute, days, active } = body;

	if (!id) {
		return NextResponse.json({ error: 'id required' }, { status: 400 });
	}

	const updates: string[] = [];
	const params: unknown[] = [];
	let idx = 1;

	if (typeof hour === 'number' && typeof minute === 'number') {
		updates.push(`hour = $${idx++}, minute = $${idx++}`);
		params.push(hour, minute);
	}
	if (Array.isArray(days)) {
		updates.push(`days = $${idx++}`);
		params.push(days);
	}
	if (typeof active === 'boolean') {
		updates.push(`active = $${idx++}`);
		params.push(active);
	}

	if (updates.length === 0) {
		return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
	}

	params.push(id);
	await query(`UPDATE schedules SET ${updates.join(', ')} WHERE id = $${idx}`, params);

	return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const id = searchParams.get('id');

	if (!id) {
		return NextResponse.json({ error: 'id required' }, { status: 400 });
	}

	await query('DELETE FROM schedules WHERE id = $1', [id]);
	return NextResponse.json({ ok: true });
}
