import { NextResponse } from 'next/server';
import { query } from '@pulsar/shared/db/postgres';

interface OrphanRow {
	id: string;
	event_type: string;
	rr_token: string | null;
	project_id: string | null;
	source: string | null;
	body: unknown;
	received_at: string;
}

interface SummaryRow {
	event_type: string;
	count: number;
}

/**
 * Ops diagnostic surface for RocketRide events that arrived without a
 * resolvable Pulsar run. Helpful for spotting correlation regressions
 * (e.g. apaevt_task begin/end events when the SDK isn't echoing source
 * back through `client.use()`).
 *
 * Query params:
 *   event_type=<string>   filter to one event type (e.g. apaevt_task)
 *   project_id=<string>   filter to one RocketRide project
 *   since=<ISO datetime>  earliest received_at
 *   limit=<int>           cap rows (default 200, max 1000)
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const eventType = url.searchParams.get('event_type');
	const projectId = url.searchParams.get('project_id');
	const sinceParam = url.searchParams.get('since');
	const limitRaw = url.searchParams.get('limit');

	const conditions: string[] = [];
	const params: unknown[] = [];

	if (eventType) {
		params.push(eventType);
		conditions.push(`event_type = $${params.length}`);
	}
	if (projectId) {
		params.push(projectId);
		conditions.push(`project_id = $${params.length}`);
	}
	if (sinceParam) {
		params.push(sinceParam);
		conditions.push(`received_at >= $${params.length}`);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
	const limit = Math.min(1000, Math.max(1, Number.parseInt(limitRaw ?? '200', 10) || 200));
	params.push(limit);

	const events = await query<OrphanRow>(
		`SELECT id, event_type, rr_token, project_id, source, body, received_at
		 FROM orphan_events
		 ${where}
		 ORDER BY received_at DESC
		 LIMIT $${params.length}`,
		params
	);

	const summary = await query<SummaryRow>(
		`SELECT event_type, COUNT(*)::int AS count
		 FROM orphan_events
		 WHERE received_at > now() - interval '24 hours'
		 GROUP BY event_type
		 ORDER BY count DESC`
	);

	return NextResponse.json({
		events: events.rows,
		summary_24h: summary.rows
	});
}
