import { RocketRideClient } from 'rocketride';
import { env } from '@pulsar/shared/config/env';
import { dispatchEvent, ensureMonitorSubscription } from './rocketride-listener.js';

let client: RocketRideClient | null = null;

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
			try {
				await ensureMonitorSubscription(client);
				console.log('[RocketRide] Monitor subscription active');
			} catch (err) {
				console.warn('[RocketRide] Failed to subscribe to events:', err);
			}
		},
		onDisconnected: async (reason, hasError) => {
			if (hasError) console.warn('[RocketRide] Disconnected:', reason);
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

/**
 * Centralized chokepoint for invoking a RocketRide pipeline.
 *
 * Currently a thin pass-through over `client.use()`. Future commits attach
 * observability here: run-id correlation registration, `pipelineTraceLevel`
 * enforcement, and listener wiring. Call this instead of `client.use()`
 * directly so that work lands in one place.
 */
export async function usePipeline(
	client: RocketRideClient,
	_runId: string,
	filepath: string
): Promise<UsePipelineResult> {
	const response = await client.use({ filepath });
	return { token: response.token, response };
}
