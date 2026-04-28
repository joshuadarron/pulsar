import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RocketRideClient } from 'rocketride';
import { env } from '@pulsar/shared/config/env';
import { logRun } from '@pulsar/shared/run-logger';
import {
	MONITOR_SUBSCRIPTION_TYPES,
	dispatchEvent,
	getActiveRuns,
	registerToken,
	unregisterToken
} from './rocketride-listener.js';

let client: RocketRideClient | null = null;
let lastDisconnectAt: number | null = null;

async function emitReconnectGapWarn(disconnectAt: number, reconnectAt: number): Promise<void> {
	const active = getActiveRuns();
	if (active.length === 0) return;
	const gapSeconds = Math.max(1, Math.round((reconnectAt - disconnectAt) / 1000));
	const fromIso = new Date(disconnectAt).toISOString();
	const toIso = new Date(reconnectAt).toISOString();
	const message = `RocketRide WS reconnected after ${gapSeconds}s; events between ${fromIso} and ${toIso} may be missing`;
	for (const { runId, pipeline } of active) {
		try {
			await logRun(runId, 'warn', `rr:${pipeline}:gap`, message, 'rocketride');
		} catch (err) {
			console.warn('[RocketRide] Failed to write reconnect-gap log:', err);
		}
	}
}

export async function getClient(): Promise<RocketRideClient> {
	if (client?.isConnected()) return client;

	client = new RocketRideClient({
		uri: env.rocketride.wsUrl,
		auth: env.rocketride.apiKey,
		persist: true,
		maxRetryTime: 30000,
		onEvent: dispatchEvent,
		onConnected: async () => {
			console.log('[RocketRide] Connected');
			if (!client) return;

			// Reconnect handling: any in-flight runs that were correlated when
			// the connection dropped get a warn log noting the gap window so
			// the run-detail timeline shows where events may be missing.
			if (lastDisconnectAt !== null) {
				const reconnectAt = Date.now();
				try {
					await emitReconnectGapWarn(lastDisconnectAt, reconnectAt);
				} catch (err) {
					console.warn('[RocketRide] reconnect-gap warn failed:', err);
				}
				lastDisconnectAt = null;
			}
			// NOTE: we do NOT call setEvents('*') here. An eager
			// connection-wide subscription was disconnecting the WS on some
			// servers (probably because the wildcard token has nothing to
			// resolve to before any tasks have started). Subscriptions are
			// now established per-task inside `usePipeline()` after
			// `client.use()` returns the token.
		},
		onDisconnected: async (reason, hasError) => {
			if (hasError) {
				console.warn('[RocketRide] Disconnected:', reason);
				lastDisconnectAt = Date.now();
			}
		}
	});

	await client.connect();
	return client;
}

export async function disconnectClient(): Promise<void> {
	if (client) {
		await client.disconnect();
		client = null;
	}
}

export interface UsePipelineResult {
	token: string;
	response: Awaited<ReturnType<RocketRideClient['use']>>;
}

const pipeProjectIdCache = new Map<string, string | undefined>();

async function readProjectId(filepath: string): Promise<string | undefined> {
	if (pipeProjectIdCache.has(filepath)) return pipeProjectIdCache.get(filepath);
	try {
		const content = await fs.readFile(filepath, 'utf-8');
		const parsed = JSON.parse(content) as { project_id?: unknown };
		const projectId = typeof parsed.project_id === 'string' ? parsed.project_id : undefined;
		pipeProjectIdCache.set(filepath, projectId);
		return projectId;
	} catch {
		pipeProjectIdCache.set(filepath, undefined);
		return undefined;
	}
}

/**
 * Centralized chokepoint for invoking a RocketRide pipeline.
 *
 * - Re-resolves `getClient()` so a stale (mid-reconnect) client doesn't bubble
 *   "Server is not connected" up the stack on the first call after a long
 *   non-WS phase (e.g. graph-snapshot, native-fetch context).
 * - Always sets `pipelineTraceLevel: 'summary'` so FLOW events fire in the
 *   observability listener.
 * - Registers the returned token (plus project_id and any source the SDK
 *   echoes back) so inbound events resolve to this run for run_logs.
 * - Subscribes to events for the returned token via `setEvents` so the
 *   monitor delivers FLOW / SUMMARY / OUTPUT / SSE events for this task.
 *
 * Pair every call with `terminatePipeline(client, token)` (or call
 * `unregisterToken(token)` directly) so the token is moved to the recently
 * ended grace bucket once the pipeline finishes.
 */
export async function usePipeline(
	_caller: RocketRideClient,
	runId: string,
	filepath: string
): Promise<UsePipelineResult> {
	const basename = path.basename(filepath, '.pipe');
	const projectIdFromFile = await readProjectId(filepath);

	// Always resolve via getClient() so a dropped/reconnecting WS triggers a
	// fresh connect rather than throwing "Server is not connected" on use().
	const client = await getClient();

	const response = await client.use({ filepath, pipelineTraceLevel: 'summary' });

	const useResp = response as Record<string, unknown> & { token: string };
	const projectIdFromResp =
		typeof useResp.project_id === 'string'
			? useResp.project_id
			: typeof useResp.projectId === 'string'
				? useResp.projectId
				: undefined;
	const source = typeof useResp.source === 'string' ? useResp.source : undefined;

	registerToken(runId, basename, response.token, {
		project_id: projectIdFromResp ?? projectIdFromFile,
		source
	});

	// Subscribe per-task; the apaevt_task `begin` event has typically fired
	// before this point, but flow / status_update / output / sse / end all
	// arrive after and will be delivered.
	try {
		await client.setEvents(response.token, MONITOR_SUBSCRIPTION_TYPES);
	} catch (err) {
		console.warn(`[RocketRide] setEvents failed for ${basename}:`, err);
	}

	return { token: response.token, response };
}

/**
 * Terminate a running pipeline and release its observability token.
 * Always pair this with `usePipeline` so the listener's recentlyEnded grace
 * window covers any trailing `apaevt_*` events.
 */
export async function terminatePipeline(client: RocketRideClient, token: string): Promise<void> {
	try {
		await client.terminate(token);
	} finally {
		unregisterToken(token);
	}
}
