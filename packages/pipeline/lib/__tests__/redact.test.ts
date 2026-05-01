import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { redactJson, redactString } from '../redact.js';

describe('redactString', () => {
	it('masks rocketride tk_ tokens, preserving the prefix', () => {
		const input =
			'token-key=tk_316718f69fc583309d936bf126e2bc770e2253d37f96cb4a07107337ff103821 trailing';
		assert.equal(redactString(input), 'token-key=tk_*** trailing');
	});

	it('masks rocketride pk_ keys, preserving the prefix', () => {
		const input =
			'auth-key=pk_0325acb94a727fbfd02e82ac6a581298c20bd5cc51e0ff18c952747de12d6ad4 done';
		assert.equal(redactString(input), 'auth-key=pk_*** done');
	});

	it('masks OpenAI / Anthropic sk- keys', () => {
		const input = 'apikey=sk-abcdef0123456789ABCDEF and more';
		assert.equal(redactString(input), 'apikey=sk-*** and more');
	});

	it('masks GitHub ghp_ tokens', () => {
		const input = 'token=ghp_0123456789ABCDEFabcdef0123456789ABCD';
		assert.equal(redactString(input), 'token=ghp_***');
	});

	it('masks AWS access keys', () => {
		assert.equal(redactString('AKIAIOSFODNN7EXAMPLE in here'), 'AKIA*** in here');
	});

	it('masks Slack tokens', () => {
		assert.equal(redactString('xoxb-12345-67890-abcdefghij'), 'xox-***');
	});

	it('returns the input unchanged when there are no matches', () => {
		const input = 'no secrets here, nothing to mask';
		assert.equal(redactString(input), input);
	});

	it('masks multiple secrets in a single string', () => {
		const input =
			'pair: pk_0325acb94a727fbfd02e82ac6a581298c20bd5cc51e0ff18c952747de12d6ad4, tk_316718f69fc583309d936bf126e2bc770e2253d37f96cb4a07107337ff103821';
		assert.equal(redactString(input), 'pair: pk_***, tk_***');
	});
});

describe('redactJson', () => {
	it('replaces values whose key is a known credential name with ***', () => {
		const input = {
			'url-text': 'Webhook interface URL',
			'url-link': '{host}/webhook',
			'auth-text': 'Public Authorization Key',
			'auth-key': 'pk_0325acb94a727fbfd02e82ac6a581298c20bd5cc51e0ff18c952747de12d6ad4',
			'token-text': 'Private Token',
			'token-key': 'tk_316718f69fc583309d936bf126e2bc770e2253d37f96cb4a07107337ff103821'
		};
		const out = redactJson(input);
		assert.deepEqual(out, {
			'url-text': 'Webhook interface URL',
			'url-link': '{host}/webhook',
			'auth-text': 'Public Authorization Key',
			'auth-key': '***',
			'token-text': 'Private Token',
			'token-key': '***'
		});
	});

	it('catches credential field names regardless of case', () => {
		const out = redactJson({ Password: 'hunter2', API_KEY: 'sk-foo' });
		assert.deepEqual(out, { Password: '***', API_KEY: '***' });
	});

	it('redacts string leaves that match secret value patterns even outside credential fields', () => {
		const out = redactJson({
			message: 'connect with tk_316718f69fc583309d936bf126e2bc770e2253d37f96cb4a07107337ff103821'
		});
		assert.deepEqual(out, { message: 'connect with tk_***' });
	});

	it('recurses into nested objects', () => {
		const input = {
			outer: {
				inner: {
					password: 'hunter2',
					note: 'no secret here'
				}
			}
		};
		assert.deepEqual(redactJson(input), {
			outer: { inner: { password: '***', note: 'no secret here' } }
		});
	});

	it('recurses into arrays', () => {
		const input = [{ apikey: 'sk-abc' }, { apikey: 'sk-def' }, { note: 'plain string' }];
		assert.deepEqual(redactJson(input), [
			{ apikey: '***' },
			{ apikey: '***' },
			{ note: 'plain string' }
		]);
	});

	it('passes through non-object scalars unchanged', () => {
		assert.equal(redactJson(42), 42);
		assert.equal(redactJson(true), true);
		assert.equal(redactJson(null), null);
		assert.equal(redactJson(undefined), undefined);
	});

	it('runs both layers: known-key replacement AND value pattern sweep on string leaves', () => {
		const input = {
			password: 'hunter2', // key-based
			note: 'token tk_316718f69fc583309d936bf126e2bc770e2253d37f96cb4a07107337ff103821 here', // value-pattern based
			plain: 'untouched'
		};
		assert.deepEqual(redactJson(input), {
			password: '***',
			note: 'token tk_*** here',
			plain: 'untouched'
		});
	});
});
