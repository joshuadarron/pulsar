import { query } from '@pulsar/shared/db/postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Correlation {
	runId: string;
	pipeline: string;
	projectId?: string;
	source?: string;
	startedAt: number;
}

export interface RrEvent {
	event: string;
	body?: unknown;
	token?: string;
	seq?: number;
}

interface UseResponseLike {
	project_id?: string;
	projectId?: string;
	source?: string;
}

interface SeenStatus {
	errors: Set<string>;
	warnings: Set<string>;
	notes: Set<string>;
	state?: number;
	exitCode?: number;
	exitMessage?: string;
}

// ---------------------------------------------------------------------------
// In-process state
// ---------------------------------------------------------------------------

const runByToken = new Map<string, Correlation>();
const runByProjectSource = new Map<string, Correlation>();
const recentlyEnded = new Map<string, { corr: Correlation; expiresAt: number }>();
const deferredBuffer = new Map<string, Array<{ event: RrEvent; receivedAt: number }>>();
const seenStatus = new Map<string, SeenStatus>();

const DEFAULT_GRACE_MS = 60_000;
const DEFERRED_BUFFER_MS = 2_000;

const psKey = (pid?: string, src?: string): string => (pid && src ? `${pid}|${src}` : '');

// ---------------------------------------------------------------------------
// Public correlation API
// ---------------------------------------------------------------------------

export function registerToken(
	runId: string,
	pipelineBasename: string,
	token: string,
	useResp?: UseResponseLike
): void {
	const projectId = useResp?.project_id ?? useResp?.projectId;
	const source = useResp?.source;
	const corr: Correlation = {
		runId,
		pipeline: pipelineBasename,
		projectId,
		source,
		startedAt: Date.now()
	};
	runByToken.set(token, corr);
	if (projectId && source) {
		const key = psKey(projectId, source);
		runByProjectSource.set(key, corr);
		drainDeferred(key);
	}
}

export function unregisterToken(token: string, gracePeriodMs = DEFAULT_GRACE_MS): void {
	const corr = runByToken.get(token);
	if (!corr) return;
	runByToken.delete(token);
	if (corr.projectId && corr.source) {
		runByProjectSource.delete(psKey(corr.projectId, corr.source));
	}
	seenStatus.delete(token);
	if (gracePeriodMs > 0) {
		recentlyEnded.set(token, { corr, expiresAt: Date.now() + gracePeriodMs });
	}
	pruneRecentlyEnded();
}

function pruneRecentlyEnded(): void {
	const now = Date.now();
	for (const [t, e] of recentlyEnded) {
		if (e.expiresAt < now) recentlyEnded.delete(t);
	}
}

function drainDeferred(key: string): void {
	const buffered = deferredBuffer.get(key);
	if (!buffered?.length) return;
	deferredBuffer.delete(key);
	for (const { event } of buffered) {
		void dispatchEvent(event);
	}
}

// Test-only reset; not exported from package index, only imported by tests.
export function __resetForTesting(): void {
	runByToken.clear();
	runByProjectSource.clear();
	recentlyEnded.clear();
	deferredBuffer.clear();
	seenStatus.clear();
}

// ---------------------------------------------------------------------------
// Correlation resolution
// ---------------------------------------------------------------------------

function extractToken(event: RrEvent, body: Record<string, unknown>): string | undefined {
	if (typeof event.token === 'string') return event.token;
	if (typeof body.token === 'string') return body.token;
	return undefined;
}

function extractProjectSource(body: Record<string, unknown>): {
	projectId?: string;
	source?: string;
} {
	const projectId =
		typeof body.project_id === 'string'
			? body.project_id
			: typeof body.projectId === 'string'
				? body.projectId
				: undefined;
	const source = typeof body.source === 'string' ? body.source : undefined;
	return { projectId, source };
}

function resolveCorrelation(event: RrEvent): Correlation | null {
	const body = (event.body ?? {}) as Record<string, unknown>;
	const token = extractToken(event, body);
	if (token) {
		const c = runByToken.get(token);
		if (c) return c;
		const r = recentlyEnded.get(token);
		if (r && r.expiresAt > Date.now()) return r.corr;
	}
	const { projectId, source } = extractProjectSource(body);
	if (projectId && source) {
		const c = runByProjectSource.get(psKey(projectId, source));
		if (c) return c;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

type LogLevel = 'info' | 'warn' | 'error' | 'success';

async function writeLog(
	corr: Correlation,
	level: LogLevel,
	stage: string,
	message: string,
	traceId?: string
): Promise<void> {
	if (traceId) {
		await query(
			`INSERT INTO run_logs (run_id, level, stage, message, source, trace_id)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[corr.runId, level, stage, message, 'rocketride', traceId]
		);
	} else {
		// Reuse logRun for the common path so any future logging side-effects
		// stay consistent. Pass source via direct INSERT until logRun grows
		// the optional arg.
		await query(
			`INSERT INTO run_logs (run_id, level, stage, message, source)
			 VALUES ($1, $2, $3, $4, $5)`,
			[corr.runId, level, stage, message, 'rocketride']
		);
	}
}

async function persistTrace(
	corr: Correlation,
	token: string | undefined,
	body: Record<string, unknown>
): Promise<string | null> {
	const pipeId = typeof body.id === 'number' ? body.id : 0;
	const op = typeof body.op === 'string' ? body.op : 'unknown';
	const pipes = Array.isArray(body.pipes) ? (body.pipes as unknown[]) : [];
	const component = typeof pipes.at(-1) === 'string' ? (pipes.at(-1) as string) : null;
	const trace = (body.trace ?? {}) as Record<string, unknown>;
	const result = body.result ?? null;
	const seq = typeof body.seq === 'number' ? body.seq : null;

	const inserted = await query<{ id: string }>(
		`INSERT INTO pipeline_run_traces
		   (run_id, rr_token, pipeline, pipe_id, op, component, trace, result, rr_seq)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING id`,
		[
			corr.runId,
			token ?? null,
			corr.pipeline,
			pipeId,
			op,
			component,
			JSON.stringify(trace),
			result === null ? null : JSON.stringify(result),
			seq
		]
	);
	return inserted.rows[0]?.id ?? null;
}

async function persistOrphan(event: RrEvent): Promise<void> {
	const body = (event.body ?? {}) as Record<string, unknown>;
	const { projectId, source } = extractProjectSource(body);
	const token = extractToken(event, body);
	await query(
		`INSERT INTO orphan_events (event_type, rr_token, project_id, source, body)
		 VALUES ($1, $2, $3, $4, $5)`,
		[
			event.event,
			token ?? null,
			projectId ?? null,
			source ?? null,
			JSON.stringify(event.body ?? {})
		]
	);
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

const stagePrefix = (pipeline: string, suffix: string): string => `rr:${pipeline}:${suffix}`;

async function handleTask(
	corr: Correlation,
	body: Record<string, unknown>,
	token?: string
): Promise<void> {
	const action = typeof body.action === 'string' ? body.action : 'unknown';
	const stage = stagePrefix(corr.pipeline, 'task');
	if (action === 'begin') {
		await writeLog(corr, 'info', stage, 'pipeline started');
		return;
	}
	if (action === 'restart') {
		await writeLog(corr, 'warn', stage, 'pipeline restarted');
		return;
	}
	if (action === 'end') {
		const status = token ? seenStatus.get(token) : undefined;
		const exitCode = status?.exitCode ?? 0;
		const exitMessage = status?.exitMessage ?? '';
		if (exitCode !== 0) {
			const detail = exitMessage ? `: ${exitMessage}` : '';
			await writeLog(corr, 'error', stage, `pipeline ended (exit=${exitCode})${detail}`);
		} else {
			await writeLog(corr, 'success', stage, 'pipeline ended');
		}
		return;
	}
	// 'running' snapshot or unknown — skip silently
}

async function handleStatusUpdate(
	corr: Correlation,
	body: Record<string, unknown>,
	token?: string
): Promise<void> {
	const stage = stagePrefix(corr.pipeline, 'status');
	const key = token ?? `${corr.runId}:${corr.pipeline}`;
	const seen = seenStatus.get(key) ?? {
		errors: new Set<string>(),
		warnings: new Set<string>(),
		notes: new Set<string>()
	};
	const errors = Array.isArray(body.errors) ? (body.errors as unknown[]) : [];
	const warnings = Array.isArray(body.warnings) ? (body.warnings as unknown[]) : [];
	const notes = Array.isArray(body.notes) ? (body.notes as unknown[]) : [];
	const exitCode = typeof body.exitCode === 'number' ? body.exitCode : undefined;
	const exitMessage = typeof body.exitMessage === 'string' ? body.exitMessage : undefined;
	const state = typeof body.state === 'number' ? body.state : undefined;

	for (const e of errors) {
		const msg = typeof e === 'string' ? e : JSON.stringify(e);
		if (!seen.errors.has(msg)) {
			seen.errors.add(msg);
			await writeLog(corr, 'error', stage, msg);
		}
	}
	for (const w of warnings) {
		const msg = typeof w === 'string' ? w : JSON.stringify(w);
		if (!seen.warnings.has(msg)) {
			seen.warnings.add(msg);
			await writeLog(corr, 'warn', stage, msg);
		}
	}
	for (const n of notes) {
		const msg = typeof n === 'string' ? n : JSON.stringify(n);
		if (!seen.notes.has(msg)) {
			seen.notes.add(msg);
			await writeLog(corr, 'info', stage, msg);
		}
	}
	if (state !== undefined && state !== seen.state) {
		seen.state = state;
		// Only log transitions to terminal states (5=COMPLETED, 6=CANCELLED)
		if (state === 5 || state === 6) {
			await writeLog(corr, 'info', stage, `state=${state === 5 ? 'COMPLETED' : 'CANCELLED'}`);
		}
	}
	if (exitCode !== undefined) seen.exitCode = exitCode;
	if (exitMessage !== undefined) seen.exitMessage = exitMessage;
	seenStatus.set(key, seen);
}

async function handleOutput(corr: Correlation, body: Record<string, unknown>): Promise<void> {
	const output = typeof body.output === 'string' ? body.output.trim() : '';
	if (!output) return;
	const category = typeof body.category === 'string' ? body.category : '';
	const level: LogLevel = category === 'stderr' ? 'warn' : 'info';
	const stage = stagePrefix(corr.pipeline, 'output');
	await writeLog(corr, level, stage, output.slice(0, 1000));
}

async function handleSse(corr: Correlation, body: Record<string, unknown>): Promise<void> {
	const sseType = typeof body.type === 'string' ? body.type : 'event';
	const stage = stagePrefix(corr.pipeline, `sse:${sseType}`);
	const data = body.data ?? {};
	const payload = JSON.stringify(data).slice(0, 600);
	await writeLog(corr, 'info', stage, payload);
}

async function handleFlow(
	corr: Correlation,
	body: Record<string, unknown>,
	token?: string
): Promise<void> {
	const op = typeof body.op === 'string' ? body.op : '';
	const pipeId = typeof body.id === 'number' ? body.id : 0;
	const pipes = Array.isArray(body.pipes) ? (body.pipes as unknown[]) : [];
	const component = typeof pipes.at(-1) === 'string' ? (pipes.at(-1) as string) : 'unknown';

	// Always persist trace row, regardless of op
	const traceId = await persistTrace(corr, token, body);

	if (op === 'enter' || op === 'leave') return; // volume control — no log row

	const stage = stagePrefix(corr.pipeline, 'flow');
	const trace = (body.trace ?? {}) as Record<string, unknown>;
	const error = typeof trace.error === 'string' ? trace.error : '';

	if (op === 'begin') {
		await writeLog(corr, 'info', stage, `pipe ${pipeId} ${component} begin`, traceId ?? undefined);
		return;
	}
	if (op === 'end') {
		if (error) {
			await writeLog(
				corr,
				'error',
				stage,
				`pipe ${pipeId} ${component} failed: ${error}`,
				traceId ?? undefined
			);
		} else {
			await writeLog(corr, 'info', stage, `pipe ${pipeId} ${component} done`, traceId ?? undefined);
		}
	}
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export async function dispatchEvent(event: RrEvent): Promise<void> {
	const body = (event.body ?? {}) as Record<string, unknown>;
	const corr = resolveCorrelation(event);

	if (!corr) {
		// Buffer briefly if we have a (project_id, source) but no map entry yet.
		// This handles the race where pipeline begin/output arrives before
		// registerToken() completes.
		const { projectId, source } = extractProjectSource(body);
		if (projectId && source) {
			const key = psKey(projectId, source);
			const buf = deferredBuffer.get(key) ?? [];
			buf.push({ event, receivedAt: Date.now() });
			deferredBuffer.set(key, buf);
			// Schedule a flush so buffered events still land somewhere if the
			// register call never comes.
			setTimeout(() => flushDeferredKey(key), DEFERRED_BUFFER_MS).unref?.();
			return;
		}
		// No correlation hint at all — orphan.
		try {
			await persistOrphan(event);
		} catch (err) {
			console.warn('[rr-listener] persistOrphan failed:', err);
		}
		return;
	}

	const token = extractToken(event, body);

	try {
		switch (event.event) {
			case 'apaevt_task':
				await handleTask(corr, body, token);
				break;
			case 'apaevt_status_update':
				await handleStatusUpdate(corr, body, token);
				break;
			case 'apaevt_flow':
				await handleFlow(corr, body, token);
				break;
			case 'apaevt_sse':
				await handleSse(corr, body);
				break;
			case 'output':
				await handleOutput(corr, body);
				break;
			default:
				// Unknown / future event types: capture as info under a generic stage.
				await writeLog(
					corr,
					'info',
					stagePrefix(corr.pipeline, event.event),
					JSON.stringify(body).slice(0, 600)
				);
		}
	} catch (err) {
		console.warn(`[rr-listener] dispatch ${event.event} failed:`, err);
	}
}

async function flushDeferredKey(key: string): Promise<void> {
	const buffered = deferredBuffer.get(key);
	if (!buffered?.length) return;
	deferredBuffer.delete(key);
	for (const { event } of buffered) {
		try {
			await persistOrphan(event);
		} catch (err) {
			console.warn('[rr-listener] flushDeferred persistOrphan failed:', err);
		}
	}
}

// ---------------------------------------------------------------------------
// Subscription helper (wired up in Commit 3)
// ---------------------------------------------------------------------------

export const MONITOR_SUBSCRIPTION_TYPES = ['TASK', 'SUMMARY', 'FLOW', 'OUTPUT', 'SSE'];

/**
 * Note: not yet called from anywhere. Commit 3 wires this into
 * lib/rocketride.ts so the SDK's onConnected handler invokes it,
 * giving us auto-resubscribe on reconnect.
 */
export async function ensureMonitorSubscription(client: {
	addMonitor?: (args: { key: { token: string }; types: string[] }) => Promise<void>;
}): Promise<void> {
	if (!client.addMonitor) return;
	await client.addMonitor({ key: { token: '*' }, types: MONITOR_SUBSCRIPTION_TYPES });
}
