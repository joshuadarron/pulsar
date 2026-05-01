import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OperatorContext } from '@pulsar/context';
import type { VoiceContext, VoiceFormat } from '@pulsar/voice';

import {
	ALL_CONTENT_PLATFORMS,
	type AngleChoice,
	type ContentPlatform,
	PLATFORM_FORMAT_SPECS,
	buildAnglePickerSystemPrompt,
	buildAnglePickerUserPrompt,
	buildDrafterSystemPrompt,
	buildDrafterUserPrompt,
	voiceFormatForPlatform
} from '../prompts/content-drafts.js';

function makeStubContext(overrides: Partial<OperatorContext> = {}): OperatorContext {
	return {
		operatorName: 'Jane Doe',
		role: 'Founder',
		orgName: 'Acme Corp',
		domain: 'market-analysis',
		allowedGitHubLogins: ['janedoe'],
		groundingUrls: ['https://acme.example.com'],
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

function makeStubVoice(overrides: Partial<VoiceContext> = {}): VoiceContext {
	return {
		profile: {
			tone: 'Direct, technical, concrete. One engineer talking to another.',
			sentencePatterns: 'Short declarative sentences. Numbers anchor claims.',
			neverWrite: 'Never use em-dashes. Never lead with hype words.',
			formats: ['long-form', 'linkedin', 'twitter', 'discord', 'other']
		},
		samples: {
			'long-form': [],
			linkedin: [],
			reddit: [],
			discord: [],
			twitter: [],
			other: []
		},
		...overrides
	};
}

describe('buildAnglePickerSystemPrompt', () => {
	it('includes operator identity, hard rules, voice profile, and the platform list', () => {
		const prompt = buildAnglePickerSystemPrompt(makeStubContext(), makeStubVoice());

		assert.match(prompt, /Acme Corp/);
		assert.match(prompt, /Acme is the reliability layer for backend systems\./);
		assert.match(prompt, /Senior backend and platform engineers/);
		assert.match(prompt, /No em-dashes anywhere\./);
		assert.match(prompt, /Acme is a runtime, not a platform\./);
		assert.match(prompt, /Lead with the technical insight, not the product pitch\./);
		assert.match(prompt, /Direct, technical, concrete\./);
		assert.match(prompt, /Short declarative sentences\./);
		assert.match(prompt, /Never use em-dashes\./);
		for (const platform of ALL_CONTENT_PLATFORMS) {
			assert.ok(
				prompt.includes(platform),
				`angle-picker system prompt should mention platform ${platform}`
			);
		}
	});

	it('declares the {opportunity_signal, angle, platforms} JSON contract and empty-array fallback', () => {
		const prompt = buildAnglePickerSystemPrompt(makeStubContext(), makeStubVoice());

		assert.match(prompt, /"opportunity_signal":/);
		assert.match(prompt, /"angle":/);
		assert.match(prompt, /"platforms":/);
		assert.match(prompt, /\{"angles": \[\]\}/);
	});

	it('does not embed any per-platform format spec body and does not leak prior operator identity', () => {
		// Pass 1 stays light; format specs land in the drafter prompt only.
		const prompt = buildAnglePickerSystemPrompt(makeStubContext(), makeStubVoice());

		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.medium));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.linkedin));
		assert.ok(!prompt.includes('RocketRide'));
	});
});

describe('buildAnglePickerUserPrompt', () => {
	it('renders every interpretation field plus all report sections', () => {
		const interpretations = {
			text: 'Three signals worth pulling forward this period.',
			interpretations: [
				{
					signal: 'CrewAI mentions doubled.',
					meaning: 'Orchestration churn is real.',
					implication: 'Runtime positioning has room to land.'
				},
				{
					signal: 'r/LocalLLaMA thread on tool integration hit 147 comments.',
					meaning: 'Tool integration is the unsolved runtime problem.',
					implication: 'Build content around runtime tool wiring.'
				}
			]
		};
		const prompt = buildAnglePickerUserPrompt({
			signalInterpretation: interpretations,
			executiveSummary: 'EXEC_SUMMARY_BODY',
			marketSnapshot: 'SNAPSHOT_BODY',
			developerSignals: 'DEV_SIGNAL_BODY'
		});

		for (const entry of interpretations.interpretations) {
			assert.ok(prompt.includes(entry.signal));
			assert.ok(prompt.includes(entry.meaning));
			assert.ok(prompt.includes(entry.implication));
		}
		assert.match(prompt, /EXEC_SUMMARY_BODY/);
		assert.match(prompt, /SNAPSHOT_BODY/);
		assert.match(prompt, /DEV_SIGNAL_BODY/);
	});

	it('renders cleanly when no interpretations are present', () => {
		const prompt = buildAnglePickerUserPrompt({
			signalInterpretation: { text: 'No signals this period.', interpretations: [] },
			executiveSummary: 'x',
			marketSnapshot: 'y',
			developerSignals: 'z'
		});

		assert.match(prompt, /no interpretations were emitted/);
	});
});

describe('buildDrafterSystemPrompt', () => {
	it('includes only the format specs whose voice formats have samples and embeds those samples', () => {
		// linkedin and twitter are 1:1 with their voice formats. The drafter
		// prompt should contain those two specs (and the unique sample bodies
		// injected for them) and exclude every other platform's spec.
		const samples: Partial<Record<VoiceFormat, string[]>> = {
			linkedin: ['UNIQUE_LINKEDIN_SAMPLE_BODY_42'],
			twitter: ['UNIQUE_TWITTER_SAMPLE_BODY_42']
		};
		const prompt = buildDrafterSystemPrompt(makeStubContext(), makeStubVoice(), samples);

		assert.ok(prompt.includes(PLATFORM_FORMAT_SPECS.linkedin));
		assert.ok(prompt.includes(PLATFORM_FORMAT_SPECS.twitter));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.hashnode));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.medium));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.devto));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.hackernews));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.discord));

		assert.match(prompt, /UNIQUE_LINKEDIN_SAMPLE_BODY_42/);
		assert.match(prompt, /UNIQUE_TWITTER_SAMPLE_BODY_42/);
	});

	it('declares the per-platform metadata contract, hard rules, and stays operator-agnostic', () => {
		const samples: Partial<Record<VoiceFormat, string[]>> = {
			'long-form': ['Long form sample.']
		};
		const prompt = buildDrafterSystemPrompt(makeStubContext(), makeStubVoice(), samples);

		assert.match(prompt, /thread_count/);
		assert.match(prompt, /canonical_url/);
		assert.match(prompt, /tags/);
		assert.match(prompt, /No em-dashes anywhere\./);
		assert.ok(!prompt.includes('RocketRide'));
	});
});

describe('buildDrafterUserPrompt', () => {
	it('renders every angle with its opportunity_signal, angle, and platforms list', () => {
		const angles: AngleChoice[] = [
			{
				opportunity_signal: 'CrewAI mentions doubled.',
				angle: 'Runtime is the layer that does not care which framework wins.',
				platforms: ['medium', 'linkedin']
			},
			{
				opportunity_signal: 'r/LocalLLaMA thread on tool integration hit 147 comments.',
				angle: 'Tool wiring is unsolved at the runtime layer.',
				platforms: ['hashnode']
			}
		];
		const prompt = buildDrafterUserPrompt({
			angles,
			reportContext: { executiveSummary: 'Exec summary.', marketSnapshot: 'Snapshot.' }
		});

		for (const a of angles) {
			assert.ok(prompt.includes(a.opportunity_signal));
			assert.ok(prompt.includes(a.angle));
		}
		assert.match(prompt, /medium, linkedin/);
		assert.match(prompt, /hashnode/);
		assert.match(prompt, /Exec summary\./);
		assert.match(prompt, /Snapshot\./);
	});

	it('handles an empty angles array without throwing', () => {
		const prompt = buildDrafterUserPrompt({
			angles: [],
			reportContext: { executiveSummary: 'x', marketSnapshot: 'y' }
		});

		assert.match(prompt, /no angles to draft/);
	});
});

describe('PLATFORM_FORMAT_SPECS', () => {
	it('covers every content platform, contains no em-dashes, and no operator hardcoding', () => {
		for (const platform of ALL_CONTENT_PLATFORMS) {
			const spec = PLATFORM_FORMAT_SPECS[platform];

			assert.ok(typeof spec === 'string' && spec.length > 0, `missing spec for ${platform}`);
			assert.ok(!spec.includes('\u2014'), `${platform} spec contains an em-dash`);
			assert.ok(!spec.includes('RocketRide'), `${platform} spec hardcodes RocketRide`);
			assert.ok(!spec.includes('rocketride.ai'), `${platform} spec hardcodes operator URLs`);
			assert.ok(!spec.includes('docs.rocketride.org'), `${platform} spec hardcodes operator URLs`);
		}
	});
});

describe('voiceFormatForPlatform', () => {
	it('maps article platforms to long-form and social platforms to their own formats', () => {
		const expected: Record<ContentPlatform, string> = {
			hashnode: 'long-form',
			medium: 'long-form',
			devto: 'long-form',
			hackernews: 'other',
			linkedin: 'linkedin',
			twitter: 'twitter',
			discord: 'discord'
		};
		for (const platform of ALL_CONTENT_PLATFORMS) {
			assert.equal(voiceFormatForPlatform(platform), expected[platform]);
		}
	});
});
