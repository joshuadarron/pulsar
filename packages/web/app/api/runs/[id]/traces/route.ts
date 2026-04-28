import { NextResponse } from 'next/server';
import { query } from '@pulsar/shared/db/postgres';

interface SummaryRow {
	id: string;
	pipeline: string;
	pipe_id: number;
	op: string;
	component: string | null;
	occurred_at: string;
	rr_seq: number | null;
}

interface FullRow extends SummaryRow {
	rr_token: string | null;
	trace: Record<string, unknown>;
	result: unknown;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id: runId } = await params;
	const url = new URL(request.url);
	const traceId = url.searchParams.get('id');

	if (traceId) {
		const result = await query<FullRow>(
			`SELECT id, pipeline, pipe_id, op, component, occurred_at, rr_seq, rr_token, trace, result
			 FROM pipeline_run_traces
			 WHERE id = $1 AND run_id = $2`,
			[traceId, runId]
		);
		if (result.rows.length === 0) {
			return NextResponse.json({ error: 'Trace not found' }, { status: 404 });
		}
		return NextResponse.json({ trace: result.rows[0] });
	}

	const pipeline = url.searchParams.get('pipeline');
	const pipeIdRaw = url.searchParams.get('pipeId');

	const conditions = ['run_id = $1'];
	const sqlParams: unknown[] = [runId];

	if (pipeline) {
		sqlParams.push(pipeline);
		conditions.push(`pipeline = $${sqlParams.length}`);
	}
	if (pipeIdRaw !== null) {
		const parsed = Number.parseInt(pipeIdRaw, 10);
		if (Number.isFinite(parsed)) {
			sqlParams.push(parsed);
			conditions.push(`pipe_id = $${sqlParams.length}`);
		}
	}

	const result = await query<SummaryRow>(
		`SELECT id, pipeline, pipe_id, op, component, occurred_at, rr_seq
		 FROM pipeline_run_traces
		 WHERE ${conditions.join(' AND ')}
		 ORDER BY occurred_at ASC, rr_seq ASC NULLS LAST
		 LIMIT 2000`,
		sqlParams
	);

	return NextResponse.json({ traces: result.rows });
}
