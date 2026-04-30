import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { SetupConfig } from '../src/types.js';
import { writeConfig } from '../src/write-config.js';

function buildConfig(overrides: Partial<SetupConfig> = {}): SetupConfig {
	return {
		operatorName: 'Test Operator',
		role: 'Test Role',
		orgName: 'Test Org',
		domain: 'market-analysis',
		positioning: 'A one sentence positioning statement.',
		audience: 'Test audience description.',
		hardRules: '- Rule one\n- Rule two',
		glossary: '- term-a: definition a',
		trackedEntities: ['EntityA', 'EntityB'],
		keywords: ['kw1', 'kw2'],
		technologies: ['tech1'],
		allowedGitHubLogins: ['ghuser1', 'ghuser2'],
		groundingUrls: ['https://example.com/'],
		voice: {
			toneRules: '- be direct',
			sentencePatterns: '- open with the signal',
			neverWrite: '- em-dashes',
			samples: {
				linkedin: ['First linkedin sample body.', 'Second linkedin sample body.']
			}
		},
		...overrides
	};
}

describe('writeConfig', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), 'pulsar-cli-test-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	describe('directory shape', () => {
		it('creates .voice and .context directories at the project root', () => {
			writeConfig(buildConfig(), { cwd: tmp });
			assert.ok(existsSync(path.join(tmp, '.voice')));
			assert.ok(existsSync(path.join(tmp, '.context')));
		});

		it('writes the four .context files with the documented names', () => {
			writeConfig(buildConfig(), { cwd: tmp });
			const contextFiles = readdirSync(path.join(tmp, '.context')).sort();
			assert.deepEqual(contextFiles, [
				'glossary.md',
				'hard-rules.md',
				'profile.md',
				'tracked-entities.md'
			]);
		});

		it('writes voice profile.md plus a samples folder per format', () => {
			writeConfig(buildConfig(), { cwd: tmp });
			const voiceEntries = readdirSync(path.join(tmp, '.voice')).sort();
			assert.deepEqual(voiceEntries, ['profile.md', 'samples']);
			const sampleDirs = readdirSync(path.join(tmp, '.voice', 'samples')).sort();
			assert.deepEqual(sampleDirs, [
				'discord',
				'linkedin',
				'long-form',
				'other',
				'reddit',
				'twitter'
			]);
		});
	});

	describe('frontmatter content', () => {
		it('writes operator metadata into .context/profile.md frontmatter', () => {
			writeConfig(buildConfig(), { cwd: tmp });
			const body = readFileSync(path.join(tmp, '.context', 'profile.md'), 'utf8');
			assert.match(body, /^---\n/);
			assert.match(body, /operatorName: Test Operator/);
			assert.match(body, /role: Test Role/);
			assert.match(body, /orgName: Test Org/);
			assert.match(body, /domain: market-analysis/);
			assert.match(body, /allowedGitHubLogins:\n {2}- ghuser1\n {2}- ghuser2/);
			assert.match(body, /groundingUrls:\n {2}- https:\/\/example\.com\//);
			assert.match(body, /# Positioning/);
			assert.match(body, /A one sentence positioning statement\./);
			assert.match(body, /# Audience/);
			assert.match(body, /Test audience description\./);
		});

		it('writes entities, keywords, and technologies into tracked-entities frontmatter', () => {
			writeConfig(buildConfig(), { cwd: tmp });
			const body = readFileSync(path.join(tmp, '.context', 'tracked-entities.md'), 'utf8');
			assert.match(body, /entities:\n {2}- EntityA\n {2}- EntityB/);
			assert.match(body, /keywords:\n {2}- kw1\n {2}- kw2/);
			assert.match(body, /technologies:\n {2}- tech1/);
		});

		it('writes voice formats list into .voice/profile.md frontmatter', () => {
			writeConfig(buildConfig(), { cwd: tmp });
			const body = readFileSync(path.join(tmp, '.voice', 'profile.md'), 'utf8');
			assert.match(body, /formats:\n {2}- long-form\n {2}- linkedin/);
			assert.match(body, /# Tone/);
			assert.match(body, /be direct/);
			assert.match(body, /# Sentence patterns/);
			assert.match(body, /# What never to write/);
		});
	});

	describe('placeholders for missing input', () => {
		it('writes placeholder comments when sections are empty', () => {
			const config = buildConfig({
				positioning: '',
				audience: '',
				hardRules: '',
				glossary: '',
				voice: {
					toneRules: '',
					sentencePatterns: '',
					neverWrite: '',
					samples: {}
				}
			});
			writeConfig(config, { cwd: tmp });
			const ctxProfile = readFileSync(path.join(tmp, '.context', 'profile.md'), 'utf8');
			assert.match(ctxProfile, /<!-- Add a one sentence positioning statement here\. -->/);
			assert.match(ctxProfile, /<!-- Describe the audience here\. -->/);

			const hardRules = readFileSync(path.join(tmp, '.context', 'hard-rules.md'), 'utf8');
			assert.match(hardRules, /<!-- Add hard rules, one per line\. -->/);

			const glossary = readFileSync(path.join(tmp, '.context', 'glossary.md'), 'utf8');
			assert.match(glossary, /<!-- term: definition/);

			const voiceProfile = readFileSync(path.join(tmp, '.voice', 'profile.md'), 'utf8');
			assert.match(voiceProfile, /<!-- Add tone rules here/);
			assert.match(voiceProfile, /<!-- Add sentence patterns here\. -->/);
			assert.match(voiceProfile, /<!-- Add things to never write here\. -->/);
		});

		it('writes a README placeholder when a sample folder has no samples', () => {
			writeConfig(buildConfig(), { cwd: tmp });
			const dir = path.join(tmp, '.voice', 'samples', 'reddit');
			const files = readdirSync(dir);
			assert.deepEqual(files, ['README.md']);
			const body = readFileSync(path.join(dir, 'README.md'), 'utf8');
			assert.match(body, /Drop reddit writing samples here/);
		});
	});

	describe('voice samples', () => {
		it('writes one file per provided sample, numbered from 1', () => {
			writeConfig(buildConfig(), { cwd: tmp });
			const linkedinDir = path.join(tmp, '.voice', 'samples', 'linkedin');
			const files = readdirSync(linkedinDir).sort();
			assert.deepEqual(files, ['sample-1.md', 'sample-2.md']);
			const first = readFileSync(path.join(linkedinDir, 'sample-1.md'), 'utf8');
			assert.match(first, /First linkedin sample body\./);
		});
	});

	describe('idempotency', () => {
		it('does not overwrite existing files on a second run', () => {
			writeConfig(buildConfig(), { cwd: tmp });
			const profilePath = path.join(tmp, '.context', 'profile.md');
			const original = readFileSync(profilePath, 'utf8');

			writeConfig(buildConfig({ operatorName: 'Different Name' }), { cwd: tmp });
			const after = readFileSync(profilePath, 'utf8');
			assert.equal(after, original);
		});
	});
});
