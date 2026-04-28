import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface QueryCall {
	sql: string;
	params: unknown[];
}

const queryCalls: QueryCall[] = [];

const mockQuery = mock.fn(async (sql: string, params?: unknown[]) => {
	queryCalls.push({ sql, params: params ?? [] });
	if (/RETURNING id/i.test(sql)) {
		return { rows: [{ id: 'trace-uuid-stub' }] };
	}
	return { rows: [] };
});

mock.module('@pulsar/shared/db/postgres', {
	namedExports: { query: mockQuery }
});

const { dispatchEvent, registerToken, unregisterToken, __resetForTesting } = await import(
	'../rocketride-listener.js'
);

function lastInsertInto(table: string): QueryCall | undefined {
	return [...queryCalls].reverse().find((c) => c.sql.includes(`INSERT INTO ${table}`));
}

function insertsInto(table: string): QueryCall[] {
	return queryCalls.filter((c) => c.sql.includes(`INSERT INTO ${table}`));
}

describe('rocketride-listener', () => {
	beforeEach(() => {
		queryCalls.length = 0;
		mockQuery.mock.resetCalls();
		__resetForTesting();
	});

	describe('correlation', () => {
		it('routes a token-bearing event to the registered run', async () => {
			registerToken('run-1', 'trend-report', 'tok-A');
			await dispatchEvent({
				event: 'apaevt_task',
				token: 'tok-A',
				body: { action: 'begin', name: 'trend', projectId: 'p', source: 's' }
			});

			const log = lastInsertInto('run_logs');
			assert.ok(log, 'expected a run_logs insert');
			assert.equal(log.params[0], 'run-1'); // run_id
			assert.equal(log.params[1], 'info'); // level
			assert.equal(log.params[2], 'rr:trend-report:task');
			assert.equal(log.params[4], 'rocketride'); // source column
		});

		it('routes by (project_id, source) when no token is present', async () => {
			registerToken('run-2', 'evaluation', 'tok-B', {
				project_id: 'proj',
				source: 'src'
			});
			await dispatchEvent({
				event: 'output',
				body: { project_id: 'proj', source: 'src', output: 'hello' }
			});

			const log = lastInsertInto('run_logs');
			assert.ok(log);
			assert.equal(log.params[0], 'run-2');
			assert.equal(log.params[2], 'rr:evaluation:output');
		});

		it('writes orphan_events when no correlation can be resolved', async () => {
			await dispatchEvent({
				event: 'apaevt_task',
				token: 'unknown-token',
				body: { action: 'end' }
			});

			const orphan = lastInsertInto('orphan_events');
			assert.ok(orphan, 'expected orphan_events insert');
			assert.equal(orphan.params[0], 'apaevt_task');
			assert.equal(orphan.params[1], 'unknown-token');
			assert.equal(insertsInto('run_logs').length, 0);
		});

		it('resolves trailing events within the grace window', async () => {
			registerToken('run-3', 'content-drafts', 'tok-C');
			unregisterToken('tok-C', 60_000);

			await dispatchEvent({
				event: 'apaevt_task',
				token: 'tok-C',
				body: { action: 'end' }
			});

			const log = lastInsertInto('run_logs');
			assert.ok(log);
			assert.equal(log.params[0], 'run-3');
		});

		it('falls through to orphan once the grace window is zero', async () => {
			registerToken('run-4', 'content-drafts', 'tok-D');
			unregisterToken('tok-D', 0);

			await dispatchEvent({
				event: 'output',
				token: 'tok-D',
				body: { output: 'late' }
			});

			assert.equal(insertsInto('run_logs').length, 0);
			assert.equal(insertsInto('orphan_events').length, 1);
		});
	});

	describe('apaevt_task level mapping', () => {
		beforeEach(() => registerToken('run-5', 'trend-report', 'tok-T'));

		it('emits success on action=end with implicit exit 0', async () => {
			await dispatchEvent({
				event: 'apaevt_task',
				token: 'tok-T',
				body: { action: 'end' }
			});
			const log = lastInsertInto('run_logs');
			assert.equal(log?.params[1], 'success');
		});

		it('emits error on action=end when the prior status_update reported a non-zero exit', async () => {
			await dispatchEvent({
				event: 'apaevt_status_update',
				token: 'tok-T',
				body: { exitCode: 2, exitMessage: 'boom' }
			});
			await dispatchEvent({
				event: 'apaevt_task',
				token: 'tok-T',
				body: { action: 'end' }
			});

			const log = lastInsertInto('run_logs');
			assert.equal(log?.params[1], 'error');
			assert.match(String(log?.params[3]), /exit=2/);
			assert.match(String(log?.params[3]), /boom/);
		});

		it('emits warn on action=restart', async () => {
			await dispatchEvent({
				event: 'apaevt_task',
				token: 'tok-T',
				body: { action: 'restart' }
			});
			const log = lastInsertInto('run_logs');
			assert.equal(log?.params[1], 'warn');
		});
	});

	describe('apaevt_status_update diff', () => {
		it('only logs newly-seen errors and warnings', async () => {
			registerToken('run-6', 'evaluation', 'tok-S');

			await dispatchEvent({
				event: 'apaevt_status_update',
				token: 'tok-S',
				body: { errors: ['first error'], warnings: ['first warn'] }
			});
			await dispatchEvent({
				event: 'apaevt_status_update',
				token: 'tok-S',
				body: {
					errors: ['first error', 'second error'],
					warnings: ['first warn']
				}
			});

			const logs = insertsInto('run_logs');
			const messages = logs.map((c) => String(c.params[3]));
			assert.deepEqual(messages, ['first error', 'first warn', 'second error']);
		});
	});

	describe('apaevt_flow', () => {
		beforeEach(() => registerToken('run-7', 'trend-report', 'tok-F'));

		it('writes a trace row plus an info log on op=begin with trace_id link', async () => {
			await dispatchEvent({
				event: 'apaevt_flow',
				token: 'tok-F',
				body: { id: 3, op: 'begin', pipes: ['agent_crewai'], trace: {} }
			});

			assert.equal(insertsInto('pipeline_run_traces').length, 1);
			const log = lastInsertInto('run_logs');
			assert.ok(log);
			assert.equal(log.params[1], 'info');
			assert.match(String(log.params[3]), /pipe 3 agent_crewai begin/);
			assert.equal(log.params[5], 'trace-uuid-stub'); // trace_id linkage
		});

		it('writes only a trace row (no log) for enter/leave', async () => {
			await dispatchEvent({
				event: 'apaevt_flow',
				token: 'tok-F',
				body: { id: 4, op: 'enter', pipes: ['agent_crewai'], trace: { lane: 'questions' } }
			});

			assert.equal(insertsInto('pipeline_run_traces').length, 1);
			assert.equal(insertsInto('run_logs').length, 0);
		});

		it('escalates op=end to error when trace.error is present', async () => {
			await dispatchEvent({
				event: 'apaevt_flow',
				token: 'tok-F',
				body: {
					id: 5,
					op: 'end',
					pipes: ['llm_ollama'],
					trace: { error: 'connection refused' }
				}
			});

			const log = lastInsertInto('run_logs');
			assert.equal(log?.params[1], 'error');
			assert.match(String(log?.params[3]), /failed: connection refused/);
		});
	});

	describe('output and sse', () => {
		beforeEach(() => registerToken('run-8', 'content-drafts', 'tok-O'));

		it('treats stderr output as warn', async () => {
			await dispatchEvent({
				event: 'output',
				token: 'tok-O',
				body: { output: 'ImportError: x', category: 'stderr' }
			});
			const log = lastInsertInto('run_logs');
			assert.equal(log?.params[1], 'warn');
			assert.equal(log?.params[2], 'rr:content-drafts:output');
		});

		it('encodes the SSE type into the stage suffix', async () => {
			await dispatchEvent({
				event: 'apaevt_sse',
				token: 'tok-O',
				body: { pipe_id: 0, type: 'tool_call', data: { tool: 'postgres', sql: 'SELECT 1' } }
			});
			const log = lastInsertInto('run_logs');
			assert.equal(log?.params[2], 'rr:content-drafts:sse:tool_call');
		});
	});
});
