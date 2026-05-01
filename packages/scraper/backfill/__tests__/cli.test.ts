import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CliValidationError, VALID_SOURCES, parseArgs, validateArgs } from '../cli.js';

describe('parseArgs', () => {
	it('parses --source, --from, --to', () => {
		const out = parseArgs(['--source=arxiv', '--from=2024-01-01', '--to=2024-01-07']);
		assert.equal(out.source, 'arxiv');
		assert.equal(out.from, '2024-01-01');
		assert.equal(out.to, '2024-01-07');
		assert.equal(out.help, false);
	});

	it('detects --help', () => {
		assert.equal(parseArgs(['--help']).help, true);
		assert.equal(parseArgs(['-h']).help, true);
	});

	it('ignores unknown flags', () => {
		const out = parseArgs(['--source=arxiv', '--garbage=true']);
		assert.equal(out.source, 'arxiv');
	});
});

describe('validateArgs', () => {
	it('returns parsed Date objects when args are valid', () => {
		const v = validateArgs({
			help: false,
			source: 'arxiv',
			from: '2024-01-01',
			to: '2024-01-07'
		});
		assert.equal(v.source, 'arxiv');
		assert.equal(v.from.toISOString(), '2024-01-01T00:00:00.000Z');
		assert.equal(v.to.toISOString(), '2024-01-07T00:00:00.000Z');
	});

	it('rejects missing --source', () => {
		assert.throws(
			() => validateArgs({ help: false, from: '2024-01-01', to: '2024-01-07' }),
			CliValidationError
		);
	});

	it('rejects missing --from', () => {
		assert.throws(
			() => validateArgs({ help: false, source: 'arxiv', to: '2024-01-07' }),
			CliValidationError
		);
	});

	it('rejects missing --to', () => {
		assert.throws(
			() => validateArgs({ help: false, source: 'arxiv', from: '2024-01-01' }),
			CliValidationError
		);
	});

	it('rejects unknown source', () => {
		assert.throws(
			() =>
				validateArgs({
					help: false,
					source: 'not-a-source',
					from: '2024-01-01',
					to: '2024-01-07'
				}),
			/Unknown source/
		);
	});

	it('rejects malformed date', () => {
		assert.throws(
			() =>
				validateArgs({
					help: false,
					source: 'arxiv',
					from: '2024/01/01',
					to: '2024-01-07'
				}),
			/expected YYYY-MM-DD/
		);
	});

	it('rejects when from is after to', () => {
		assert.throws(
			() =>
				validateArgs({
					help: false,
					source: 'arxiv',
					from: '2024-02-01',
					to: '2024-01-07'
				}),
			/--from must be on or before --to/
		);
	});

	it('VALID_SOURCES covers the active source registry', () => {
		assert.ok(VALID_SOURCES.includes('arxiv'));
		assert.ok(VALID_SOURCES.includes('reddit'));
		assert.ok(VALID_SOURCES.includes('hackernews'));
	});
});
