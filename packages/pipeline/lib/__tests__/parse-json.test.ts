import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractJson } from '../parse-json.js';

describe('extractJson', () => {
	describe('happy path', () => {
		it('parses a clean JSON object', () => {
			const result = extractJson<{ name: string; n: number }>('{"name":"pulsar","n":1}');
			assert.deepEqual(result, { name: 'pulsar', n: 1 });
		});

		it('parses JSON wrapped in a ```json fenced block', () => {
			const raw = 'preamble\n```json\n{"ok":true}\n```\ntrailing';
			const result = extractJson<{ ok: boolean }>(raw);
			assert.deepEqual(result, { ok: true });
		});

		it('parses JSON wrapped in an unlabeled fenced block', () => {
			const raw = '```\n{"a":1,"b":2}\n```';
			const result = extractJson<{ a: number; b: number }>(raw);
			assert.deepEqual(result, { a: 1, b: 2 });
		});
	});

	describe('messy LLM output', () => {
		it('extracts the first balanced { ... } block from prose', () => {
			const raw = 'Here is your data: {"key":"value","nested":{"x":1}} let me know.';
			const result = extractJson<{ key: string; nested: { x: number } }>(raw);
			assert.deepEqual(result, { key: 'value', nested: { x: 1 } });
		});

		it('recovers JSON with trailing commas', () => {
			const raw = '{"a":1,"b":2,}';
			const result = extractJson<{ a: number; b: number }>(raw);
			assert.deepEqual(result, { a: 1, b: 2 });
		});

		it('parses a Python-style single-quoted dict with True/False/None', () => {
			const raw = "{'name': 'pulsar', 'ok': True, 'failed': False, 'note': None}";
			const result = extractJson<{ name: string; ok: boolean; failed: boolean; note: null }>(raw);
			assert.deepEqual(result, { name: 'pulsar', ok: true, failed: false, note: null });
		});

		it('preserves apostrophes inside Python-dict string values', () => {
			const raw = "{'msg': \"it's working\"}";
			const result = extractJson<{ msg: string }>(raw);
			assert.equal(result.msg, "it's working");
		});
	});

	describe('errors', () => {
		it('throws SyntaxError on garbage input', () => {
			assert.throws(() => extractJson('not json at all just words'), SyntaxError);
		});

		it('throws SyntaxError on empty input', () => {
			assert.throws(() => extractJson(''), SyntaxError);
		});
	});
});
