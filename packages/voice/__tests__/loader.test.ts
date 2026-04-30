import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { loadVoiceContext } from '../src/loader.js';
import { VoiceContextNotConfiguredError } from '../src/types.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const HAPPY_DIR = path.join(FIXTURES_DIR, '.voice');
const PROFILE_ONLY_DIR = path.join(FIXTURES_DIR, 'profile-only', '.voice');
const TOKEN_CAP_DIR = path.join(FIXTURES_DIR, 'token-cap', '.voice');
const MISSING_DIR = path.join(FIXTURES_DIR, 'missing-config', '.voice');

function setVoiceDir(dir: string): void {
	process.env.PULSAR_VOICE_DIR = dir;
}

function clearVoiceDir(): void {
	// biome-ignore lint/performance/noDelete: must remove env var, not stringify undefined
	delete process.env.PULSAR_VOICE_DIR;
}

describe('loadVoiceContext', () => {
	beforeEach(() => {
		clearVoiceDir();
	});

	describe('happy path', () => {
		it('loads profile sections and samples for requested formats', () => {
			setVoiceDir(HAPPY_DIR);
			const ctx = loadVoiceContext(['long-form', 'linkedin']);

			assert.match(ctx.profile.tone, /Direct, technical/);
			assert.match(ctx.profile.sentencePatterns, /Short declarative/);
			assert.match(ctx.profile.neverWrite, /No em-dashes/);
			assert.deepEqual(ctx.profile.formats, ['long-form', 'linkedin', 'reddit']);

			assert.equal(ctx.samples['long-form'].length, 2);
			assert.equal(ctx.samples.linkedin.length, 1);
			assert.equal(ctx.samples.reddit.length, 0);
			assert.equal(ctx.samples.discord.length, 0);
		});

		it('caps samples per format at 3', () => {
			const dir = path.join(FIXTURES_DIR, 'cap-three', '.voice');
			const samplesDir = path.join(dir, 'samples', 'long-form');
			rmSync(path.dirname(dir), { recursive: true, force: true });
			mkdirSync(samplesDir, { recursive: true });
			writeFileSync(
				path.join(dir, 'profile.md'),
				'---\nformats:\n  - long-form\n---\n\n# Tone\nx\n\n# Sentence patterns\nx\n\n# What never to write\nx\n'
			);
			for (let i = 1; i <= 5; i += 1) {
				writeFileSync(path.join(samplesDir, `sample-${i}.md`), `body-${i}`);
			}

			setVoiceDir(dir);
			const ctx = loadVoiceContext(['long-form']);
			assert.equal(ctx.samples['long-form'].length, 3);

			rmSync(path.dirname(dir), { recursive: true, force: true });
		});
	});

	describe('partial fixture', () => {
		it('returns empty arrays for formats with no samples directory', () => {
			setVoiceDir(PROFILE_ONLY_DIR);
			const ctx = loadVoiceContext(['long-form', 'twitter']);

			assert.equal(ctx.profile.tone, 'Concise.');
			assert.deepEqual(ctx.samples['long-form'], []);
			assert.deepEqual(ctx.samples.twitter, []);
		});
	});

	describe('missing config', () => {
		before(() => {
			rmSync(MISSING_DIR, { recursive: true, force: true });
			mkdirSync(MISSING_DIR, { recursive: true });
		});

		after(() => {
			rmSync(path.dirname(MISSING_DIR), { recursive: true, force: true });
		});

		it('throws VoiceContextNotConfiguredError when profile.md is absent', () => {
			setVoiceDir(MISSING_DIR);
			assert.throws(
				() => loadVoiceContext(['long-form']),
				(err: unknown) => {
					assert.ok(err instanceof VoiceContextNotConfiguredError);
					assert.match((err as Error).message, /pnpm setup/);
					return true;
				}
			);
		});
	});

	describe('token cap', () => {
		const samplesDir = path.join(TOKEN_CAP_DIR, 'samples', 'long-form');

		before(() => {
			mkdirSync(samplesDir, { recursive: true });
			const big = 'a'.repeat(20000);
			writeFileSync(path.join(samplesDir, 'sample-1.md'), big);
			writeFileSync(path.join(samplesDir, 'sample-2.md'), big);
			writeFileSync(path.join(samplesDir, 'sample-3.md'), 'short body');
		});

		after(() => {
			rmSync(samplesDir, { recursive: true, force: true });
		});

		it('drops longest samples first when total exceeds the cap', () => {
			setVoiceDir(TOKEN_CAP_DIR);
			const ctx = loadVoiceContext(['long-form']);

			const total = ctx.samples['long-form'].reduce((sum, s) => sum + s.length, 0);
			assert.ok(total <= 32000, `expected total <= 32000, got ${total}`);
			assert.ok(
				ctx.samples['long-form'].some((s) => s === 'short body'),
				'short sample should survive the cap'
			);
		});
	});
});
