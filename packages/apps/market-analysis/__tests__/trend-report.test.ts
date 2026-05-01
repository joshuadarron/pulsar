import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OperatorContext } from '@pulsar/context';

import {
	buildSectionPrompts,
	buildSupportingResourcesPrompt,
	buildSystemPrompt
} from '../prompts/trend-report.js';

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

		it('includes the new tone directives added in Phase 4', () => {
			const prompt = buildSystemPrompt(makeStubContext());

			assert.match(
				prompt,
				/Write like one engineer telling another what they just saw in the data\./
			);
			assert.match(prompt, /Lead with the story, support with the number\. Not the inverse\./);
			assert.match(prompt, /One number per claim\. Do not chain three statistics in a sentence\./);
			assert.match(
				prompt,
				/Cut hedging adjectives like "significantly", "substantially", "notably"\./
			);
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
			'developerSignals',
			'executiveSummary',
			'marketSnapshot',
			'signalInterpretation',
			'supportingResources'
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
			'marketSnapshot',
			'developerSignals',
			'signalInterpretation',
			'executiveSummary'
		];
		for (const key of operatorFacingSections) {
			assert.ok(
				prompts[key].includes('Acme Corp'),
				`section ${key} should reference the configured operator org name`
			);
		}
	});

	it('signalInterpretation prompt forbids platform names and CTAs', () => {
		const prompts = buildSectionPrompts(makeStubContext());

		assert.match(prompts.signalInterpretation, /Do not name distribution platforms/i);
		assert.match(prompts.signalInterpretation, /Do not write CTAs/i);
	});

	it('signalInterpretation prompt declares the {signal, meaning, implication} contract', () => {
		const prompts = buildSectionPrompts(makeStubContext());
		const body = prompts.signalInterpretation;

		assert.match(body, /"signal":/);
		assert.match(body, /"meaning":/);
		assert.match(body, /"implication":/);
		assert.match(body, /3 to 7/);
	});

	it('signalInterpretation prompt forbids padding to a target count', () => {
		const prompts = buildSectionPrompts(makeStubContext());

		assert.match(prompts.signalInterpretation, /Do not pad/i);
	});

	it('marketSnapshot enforces the 200-300 word, 2-3 paragraph budget', () => {
		const prompts = buildSectionPrompts(makeStubContext());

		assert.match(prompts.marketSnapshot, /200 to 300 words/);
		assert.match(prompts.marketSnapshot, /2 to 3 paragraphs|two to three paragraphs/i);
	});

	it('developerSignals drops the legacy top-author and sentiment-dump scaffolding', () => {
		const prompts = buildSectionPrompts(makeStubContext());

		// Phase 4: the section is now 2-3 prose paragraphs without those tables.
		assert.match(prompts.developerSignals, /Top-author tables/i);
		assert.match(prompts.developerSignals, /Sentiment percentage dumps/i);
	});

	it('executiveSummary enforces the 100-150 word, 3-5 sentence budget', () => {
		const prompts = buildSectionPrompts(makeStubContext());

		assert.match(prompts.executiveSummary, /100 to 150 words/);
		assert.match(prompts.executiveSummary, /3 to 5 sentences|Three to five sentences/i);
	});

	it('supportingResources prompt declares the {url, title, why} output and 10-link cap', () => {
		const prompts = buildSectionPrompts(makeStubContext());
		const body = prompts.supportingResources;

		assert.match(body, /"url"/);
		assert.match(body, /"title"/);
		assert.match(body, /"why"/);
		assert.match(body, /10/);
	});
});

describe('buildSupportingResourcesPrompt', () => {
	it('matches what buildSectionPrompts emits for the supportingResources key', () => {
		const standalone = buildSupportingResourcesPrompt(makeStubContext());
		const fromSection = buildSectionPrompts(makeStubContext()).supportingResources;

		assert.equal(standalone, fromSection);
	});

	it('threads the operator org name into the rationale framing', () => {
		const prompt = buildSupportingResourcesPrompt(makeStubContext());

		assert.match(prompt, /Acme Corp/);
	});

	it('never leaks the prior hardcoded RocketRide identity', () => {
		const prompt = buildSupportingResourcesPrompt(makeStubContext());

		assert.ok(!prompt.includes('RocketRide'));
	});
});
