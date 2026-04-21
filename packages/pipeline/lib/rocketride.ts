import { RocketRideClient } from "rocketride";
import { env } from "@pulsar/shared/config/env";

let client: RocketRideClient | null = null;

export async function getClient(): Promise<RocketRideClient> {
  if (client?.isConnected()) return client;

  client = new RocketRideClient({
    uri: env.rocketride.wsUrl,
    auth: env.rocketride.apiKey,
    persist: true,
    maxRetryTime: 30000,
    onConnected: async () => {
      console.log("[RocketRide] Connected");
    },
    onDisconnected: async (reason, hasError) => {
      if (hasError) console.warn("[RocketRide] Disconnected:", reason);
    },
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
