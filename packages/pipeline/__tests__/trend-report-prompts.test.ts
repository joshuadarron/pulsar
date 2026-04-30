import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OperatorContext } from '@pulsar/context';

import { buildSectionPrompts, buildSystemPrompt } from '../trend-report-prompts.js';

function makeStubContext(overrides: Partial<OperatorContext> = {}): OperatorContext {
	return {
		operatorName: 'Jane Doe',
		role: 'Founder',
		orgName: 'Acme Corp',
		domain: 'market-analysis',
		allowedGitHubLogins: ['janedoe'],
		groundingUrls: ['https://acme.example.com', 'https://blog.acme.example.com'],
		positioning: 'Acme is the reliability layer for backend systems.',
		audience: 'Senior backend and platform engineers building production systems.',
		hardRules: [
			'No em-dashes anywhere. Use commas, colons, periods, parentheses.',
			'Acme is a runtime, not a platform.'
		],
		glossary: {},
		trackedEntities: { entities: [], keywords: [], technologies: [] },
		...overrides
	};
}

describe('buildSystemPrompt', () => {
	describe('happy path', () => {
		it('interpolates the operator org name, positioning, and audience', () => {
			const prompt = buildSystemPrompt(makeStubContext());

			assert.match(prompt, /Acme Corp/);
			assert.match(prompt, /Acme is the reliability layer for backend systems\./);
			assert.match(prompt, /Senior backend and platform engineers/);
		});

		it('includes every operator-supplied hard rule and the static rules', () => {
			const prompt = buildSystemPrompt(makeStubContext());

			assert.match(prompt, /No em-dashes anywhere\. Use commas, colons, periods, parentheses\./);
			assert.match(prompt, /Acme is a runtime, not a platform\./);
			assert.match(prompt, /Every claim in text must trace to either the provided data/);
			assert.match(prompt, /Prefer "the data shows" over "it appears" or "it seems\."/);
		});

		it('lists each grounding URL as a bullet', () => {
			const prompt = buildSystemPrompt(makeStubContext());

			assert.match(prompt, /- https:\/\/acme\.example\.com/);
			assert.match(prompt, /- https:\/\/blog\.acme\.example\.com/);
		});

		it('preserves the JSON output contract verbatim', () => {
			const prompt = buildSystemPrompt(makeStubContext());

			const expectedContract = [
				'## Output format',
				'',
				'Respond with ONLY a raw JSON object. No markdown fences, no preamble, no explanation outside the JSON.',
				'',
				'For sections with research tools available, return:',
				'{',
				'  "text": "Your analytical narrative here.",',
				'  "research": [',
				'    {',
				'      "url": "https://...",',
				'      "sourceType": "documentation|blog|repository|social|news",',
				'      "claimSupported": "The specific claim this supports.",',
				'      "excerpt": "Relevant quote from the source.",',
				'      "retrievedAt": "ISO-8601 timestamp"',
				'    }',
				'  ]',
				'}',
				'',
				'For the executive summary (no research), return:',
				'{',
				'  "text": "Your synthesis here."',
				'}',
				'',
				'If the research array would be empty, omit it entirely.'
			].join('\n');

			assert.ok(
				prompt.includes(expectedContract),
				'system prompt must preserve the JSON output contract verbatim'
			);
		});
	});

	describe('operator agnosticism', () => {
		it('does not leak the prior hardcoded RocketRide identity when the stub is different', () => {
			const prompt = buildSystemPrompt(makeStubContext());

			assert.ok(
				!prompt.includes('RocketRide'),
				'system prompt must not contain the literal "RocketRide" when the operator stub is unrelated'
			);
		});

		it('renders cleanly when grounding URLs are empty', () => {
			const prompt = buildSystemPrompt(makeStubContext({ groundingUrls: [] }));

			assert.match(prompt, /No operator-specific grounding URLs configured\./);
		});
	});
});

describe('buildSectionPrompts', () => {
	it('returns the five expected section keys', () => {
		const prompts = buildSectionPrompts(makeStubContext());

		assert.deepEqual(Object.keys(prompts).sort(), [
			'contentRecommendations',
			'developerSignals',
			'executiveSummary',
			'marketLandscape',
			'technologyTrends'
		]);
	});

	it('never leaks RocketRide in any section', () => {
		const prompts = buildSectionPrompts(makeStubContext());

		for (const [key, body] of Object.entries(prompts)) {
			assert.ok(
				!body.includes('RocketRide'),
				`section ${key} should not contain the literal "RocketRide"`
			);
		}
	});

	it('threads the operator org name into the operator-facing sections', () => {
		const prompts = buildSectionPrompts(makeStubContext());

		// These sections explicitly reference the operator's competitive window
		// or value proposition, so they must reflect the configured org name.
		const operatorFacingSections = [
			'marketLandscape',
			'developerSignals',
			'contentRecommendations',
			'executiveSummary'
		];
		for (const key of operatorFacingSections) {
			assert.ok(
				prompts[key].includes('Acme Corp'),
				`section ${key} should reference the configured operator org name`
			);
		}
	});
});
