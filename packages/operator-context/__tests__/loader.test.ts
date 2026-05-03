import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { loadOperatorContext } from '../src/loader.js';
import { OperatorContextNotConfiguredError } from '../src/types.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const HAPPY_DIR = path.join(FIXTURES_DIR, '.context');
const PROFILE_ONLY_DIR = path.join(FIXTURES_DIR, 'profile-only', '.context');
const MISSING_DIR = path.join(FIXTURES_DIR, 'missing-config', '.context');

function setContextDir(dir: string): void {
	process.env.PULSAR_CONTEXT_DIR = dir;
}

function clearContextDir(): void {
	// biome-ignore lint/performance/noDelete: must remove env var, not stringify undefined
	delete process.env.PULSAR_CONTEXT_DIR;
}

describe('loadOperatorContext', () => {
	beforeEach(() => {
		clearContextDir();
	});

	describe('happy path', () => {
		it('parses frontmatter, body sections, hard rules, glossary, and tracked entities', () => {
			setContextDir(HAPPY_DIR);
			const ctx = loadOperatorContext();

			assert.equal(ctx.operatorName, 'Jane Doe');
			assert.equal(ctx.role, 'Founder');
			assert.equal(ctx.orgName, 'Acme Corp');
			assert.equal(ctx.domain, 'market-analysis');
			assert.deepEqual(ctx.allowedGitHubLogins, ['janedoe', 'acme-bot']);
			assert.deepEqual(ctx.groundingUrls, [
				'https://acme.example.com',
				'https://blog.acme.example.com'
			]);

			assert.match(ctx.positioning, /Acme Corp builds tooling/);
			assert.match(ctx.audience, /Senior backend and platform engineers/);

			assert.deepEqual(ctx.hardRules, [
				'No em-dashes anywhere. Use commas, colons, periods, parentheses.',
				'Acme is a runtime, not a platform.',
				'Never claim a product feature that has not shipped.',
				'One number per claim.'
			]);

			assert.equal(ctx.glossary.ACME, 'shorthand for Acme Corp internal usage');
			assert.equal(ctx.glossary.SLO, 'service level objective, target reliability of a system');
			assert.equal(ctx.glossary.RPO, 'recovery point objective');
			assert.equal(ctx.glossary.RTO, 'recovery time objective');

			assert.deepEqual(ctx.trackedEntities.entities, ['Acme Corp', 'Globex']);
			assert.deepEqual(ctx.trackedEntities.keywords, ['reliability', 'backend', 'SLO']);
			assert.deepEqual(ctx.trackedEntities.technologies, ['postgres', 'kubernetes', 'kafka']);
		});
	});

	describe('partial fixture', () => {
		it('returns sensible defaults when only profile.md is present', () => {
			setContextDir(PROFILE_ONLY_DIR);
			const ctx = loadOperatorContext();

			assert.equal(ctx.operatorName, 'Solo Operator');
			assert.equal(ctx.domain, 'technical-roadmap');
			assert.deepEqual(ctx.hardRules, []);
			assert.deepEqual(ctx.glossary, {});
			assert.deepEqual(ctx.trackedEntities, {
				entities: [],
				keywords: [],
				technologies: []
			});
			assert.deepEqual(ctx.groundingUrls, []);
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

		it('throws OperatorContextNotConfiguredError when profile.md is absent', () => {
			setContextDir(MISSING_DIR);
			assert.throws(
				() => loadOperatorContext(),
				(err: unknown) => {
					assert.ok(err instanceof OperatorContextNotConfiguredError);
					assert.match((err as Error).message, /pnpm setup/);
					return true;
				}
			);
		});
	});
});
