import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { substitutePipeEnvVars } from '../rocketride.js';

// TODO(rocketride-env): Drop this test file once the rocketride runtime loads
// env vars itself and pulsar removes substitutePipeEnvVars from rocketride.ts.

describe('substitutePipeEnvVars', () => {
	const saved: Record<string, string | undefined> = {};
	beforeEach(() => {
		for (const k of ['POSTGRES_PASSWORD', 'NEO4J_PASSWORD', 'WITH_QUOTE', 'WITH_BACKSLASH']) {
			saved[k] = process.env[k];
			delete process.env[k];
		}
	});
	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it('substitutes resolved vars and reports none missing', () => {
		process.env.POSTGRES_PASSWORD = 'pulsar_dev';
		const input = '{ "password": "${POSTGRES_PASSWORD}" }';
		const { resolved, missing } = substitutePipeEnvVars(input);
		assert.equal(resolved, '{ "password": "pulsar_dev" }');
		assert.deepEqual(missing, []);
	});

	it('leaves unset vars as the literal placeholder and reports them as missing', () => {
		const input = '{ "password": "${NEO4J_PASSWORD}" }';
		const { resolved, missing } = substitutePipeEnvVars(input);
		assert.equal(resolved, '{ "password": "${NEO4J_PASSWORD}" }');
		assert.deepEqual(missing, ['NEO4J_PASSWORD']);
	});

	it('does not modify content with no placeholders', () => {
		const input = '{ "password": "literal" }';
		const { resolved, missing } = substitutePipeEnvVars(input);
		assert.equal(resolved, input);
		assert.deepEqual(missing, []);
	});

	it('JSON-escapes embedded double quotes in values so output stays valid JSON', () => {
		process.env.WITH_QUOTE = 'a"b';
		const input = '{ "x": "${WITH_QUOTE}" }';
		const { resolved } = substitutePipeEnvVars(input);
		assert.equal(resolved, '{ "x": "a\\"b" }');
		// Verify the result actually parses
		const parsed = JSON.parse(resolved) as { x: string };
		assert.equal(parsed.x, 'a"b');
	});

	it('JSON-escapes embedded backslashes in values', () => {
		process.env.WITH_BACKSLASH = 'a\\b';
		const input = '{ "x": "${WITH_BACKSLASH}" }';
		const { resolved } = substitutePipeEnvVars(input);
		assert.equal(resolved, '{ "x": "a\\\\b" }');
		const parsed = JSON.parse(resolved) as { x: string };
		assert.equal(parsed.x, 'a\\b');
	});

	it('substitutes multiple distinct vars and dedupes the missing list', () => {
		process.env.POSTGRES_PASSWORD = 'pulsar_dev';
		const input =
			'{ "p": "${POSTGRES_PASSWORD}", "n1": "${NEO4J_PASSWORD}", "n2": "${NEO4J_PASSWORD}" }';
		const { resolved, missing } = substitutePipeEnvVars(input);
		assert.equal(
			resolved,
			'{ "p": "pulsar_dev", "n1": "${NEO4J_PASSWORD}", "n2": "${NEO4J_PASSWORD}" }'
		);
		assert.deepEqual(missing, ['NEO4J_PASSWORD']);
	});

	it('treats empty string env vars as missing (avoids sending empty creds to rocketride)', () => {
		process.env.POSTGRES_PASSWORD = '';
		const input = '{ "password": "${POSTGRES_PASSWORD}" }';
		const { resolved, missing } = substitutePipeEnvVars(input);
		assert.equal(resolved, '{ "password": "${POSTGRES_PASSWORD}" }');
		assert.deepEqual(missing, ['POSTGRES_PASSWORD']);
	});
});
