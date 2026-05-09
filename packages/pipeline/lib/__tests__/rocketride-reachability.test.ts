import assert from 'node:assert/strict';
import net from 'node:net';
import { describe, it } from 'node:test';

import {
	RocketRideRuntimeUnreachableError,
	assertRuntimeReachable,
	parseRuntimeHostPort
} from '../rocketride.js';

describe('parseRuntimeHostPort', () => {
	it('extracts host and explicit port from a ws:// URI', () => {
		assert.deepEqual(parseRuntimeHostPort('ws://localhost:5565'), {
			host: 'localhost',
			port: 5565
		});
	});

	it('extracts host and explicit port from an http:// URI', () => {
		assert.deepEqual(parseRuntimeHostPort('http://127.0.0.1:5565'), {
			host: '127.0.0.1',
			port: 5565
		});
	});

	it('falls back to scheme default port when the URI omits one', () => {
		assert.deepEqual(parseRuntimeHostPort('wss://runtime.example.com'), {
			host: 'runtime.example.com',
			port: 443
		});
		assert.deepEqual(parseRuntimeHostPort('http://runtime.example.com'), {
			host: 'runtime.example.com',
			port: 80
		});
	});

	it('returns null for malformed URIs', () => {
		assert.equal(parseRuntimeHostPort('not-a-uri'), null);
		assert.equal(parseRuntimeHostPort(''), null);
	});
});

describe('assertRuntimeReachable', () => {
	it('throws RocketRideRuntimeUnreachableError when the target port is closed', async () => {
		// Bind, capture the port, then close so we have a port that is reliably
		// not listening for the duration of the test.
		const probe = await new Promise<number>((resolve) => {
			const server = net.createServer();
			server.listen(0, '127.0.0.1', () => {
				const addr = server.address();
				const port = typeof addr === 'object' && addr ? addr.port : 0;
				server.close(() => resolve(port));
			});
		});
		await assert.rejects(
			() => assertRuntimeReachable(`ws://127.0.0.1:${probe}`),
			(err) => err instanceof RocketRideRuntimeUnreachableError
		);
	});

	it('throws RocketRideRuntimeUnreachableError when the URI is malformed', async () => {
		await assert.rejects(
			() => assertRuntimeReachable('not-a-valid-uri'),
			(err) => err instanceof RocketRideRuntimeUnreachableError
		);
	});

	it('resolves when something is listening on the host:port', async () => {
		const server = net.createServer((socket) => socket.destroy());
		const port = await new Promise<number>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => {
				const addr = server.address();
				if (typeof addr !== 'object' || !addr) {
					reject(new Error('no address from server.address()'));
					return;
				}
				resolve(addr.port);
			});
		});
		try {
			await assertRuntimeReachable(`ws://127.0.0.1:${port}`);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});

describe('RocketRideRuntimeUnreachableError', () => {
	it('carries the URI and a clear operator-facing message', () => {
		const err = new RocketRideRuntimeUnreachableError('ws://localhost:5565');
		assert.equal(err.uri, 'ws://localhost:5565');
		assert.match(err.message, /not reachable at ws:\/\/localhost:5565/);
		assert.match(err.message, /Make sure the runtime is running/);
	});

	it('preserves the underlying cause when one is supplied', () => {
		const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
		const err = new RocketRideRuntimeUnreachableError('ws://localhost:5565', cause);
		assert.equal((err as Error & { cause?: unknown }).cause, cause);
	});
});
