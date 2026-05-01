import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OperatorContext } from '@pulsar/context';
import type { ContentDraft, ReportData } from '@pulsar/shared/types';
import type { VoiceContext, VoiceFormat } from '@pulsar/voice';

import {
	type FillContext,
	POST_STEP_PLATFORM_LIST,
	fillPostSteps,
	fillTopicRefinementPrompt,
	fillVoiceTransferPrompt
} from '../fill.js';

function makeOperator(overrides: Partial<OperatorContext> = {}): OperatorContext {
	return {
		operatorName: 'Jane Doe',
		role: 'Founder',
		orgName: 'Acme Corp',
		domain: 'market-analysis',
		allowedGitHubLogins: ['janedoe'],
		groundingUrls: ['https://acme.example.com'],
		positioning: 'Acme is the reliability layer for backend systems.',
		audience: 'Senior backend and platform engineers building production systems.',
		hardRules: ['No em-dashes anywhere.'],
		glossary: {},
		trackedEntities: { entities: [], keywords: [], technologies: [] },
		...overrides
	};
}

function makeVoice(samples: Partial<Record<VoiceFormat, string[]>> = {}): VoiceContext {
	return {
		profile: {
			tone: 'Direct, technical, concrete.',
			sentencePatterns: 'Short declarative sentences. Numbers anchor claims.',
			neverWrite: 'Never use em-dashes. Never lead with hype words.',
			formats: ['long-form', 'linkedin', 'twitter', 'discord', 'other']
		},
		samples: {
			'long-form': samples['long-form'] ?? [],
			linkedin: samples.linkedin ?? [],
			reddit: samples.reddit ?? [],
			discord: samples.discord ?? [],
			twitter: samples.twitter ?? [],
			other: samples.other ?? []
		}
	};
}

function makeReport(overrides?: {
	interpretations?: ReportData['sections']['signalInterpretation']['interpretations'];
}): ReportData {
	return {
		reportMetadata: {
			periodStart: '2026-04-01',
			periodEnd: '2026-04-30',
			sourcesCount: 0,
			articleCount: 0
		},
		sections: {
			executiveSummary: { text: 'EXEC_SUMMARY_BODY' },
			marketSnapshot: { text: 'SNAPSHOT_BODY' },
			developerSignals: { text: 'DEV_SIGNALS_BODY' },
			signalInterpretation: {
				text: 'Three signals worth pulling forward this period.',
				interpretations: overrides?.interpretations ?? [
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
			},
			supportingResources: { resources: [] }
		},
		charts: {
			keywordDistribution: {
				windowStart: '2026-04-01',
				windowEnd: '2026-04-30',
				totalArticles: 0,
				buckets: []
			},
			entityCentrality: {
				currentPeriodEnd: '2026-04-30',
				periodKind: 'month',
				sparse: true,
				series: []
			}
		}
	};
}

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
	return {
		id: 'draft-1',
		runId: 'run-1',
		reportId: 'report-1',
		platform: 'hashnode',
		contentType: 'article',
		body: '# Runtime is the layer\n\nThe orchestration layer is the wrong cut.',
		status: 'draft',
		angle: 'Runtime is the layer that does not care which framework wins.',
		opportunitySignal: 'CrewAI mentions doubled.',
		metadata: { tags: ['runtime', 'agents'], canonical_url: 'https://blog.example.com/x' },
		createdAt: new Date('2026-04-30T12:00:00Z'),
		updatedAt: new Date('2026-04-30T12:00:00Z'),
		...overrides
	};
}

function makeContext(overrides: Partial<FillContext> = {}): FillContext {
	return {
		draft: makeDraft(),
		operator: makeOperator(),
		voice: makeVoice(),
		report: makeReport(),
		...overrides
	};
}

describe('fillPostSteps', () => {
	it('renders the hashnode template with title, joined tags, and canonical URL substituted', () => {
		const out = fillPostSteps(makeContext());

		assert.match(out, /Open Hashnode and create a new post\./);
		assert.match(out, /Title: Runtime is the layer/);
		assert.match(out, /Tags: runtime, agents/);
		assert.match(out, /Canonical URL: https:\/\/blog\.example\.com\/x/);
		assert.match(out, /\{\{schedule_time\}\}/);
		assert.ok(!out.includes('\u2014'), 'output must not contain em-dash');
	});

	it('leaves canonical_url placeholder as "(leave blank)" when metadata canonical_url is null', () => {
		const ctx = makeContext({
			draft: makeDraft({
				metadata: { tags: ['runtime'], canonical_url: null }
			})
		});
		const out = fillPostSteps(ctx);

		assert.match(out, /Canonical URL: \(leave blank\)/);
	});

	it('renders "(none)" for tags when metadata.tags is empty array', () => {
		const ctx = makeContext({
			draft: makeDraft({
				metadata: { tags: [], canonical_url: null }
			})
		});
		const out = fillPostSteps(ctx);

		assert.match(out, /Tags: \(none\)/);
	});

	it('falls back to first 80 chars of body when no H1 is present', () => {
		const longBody =
			'Channels show a measurable drift in tool-wiring discussion week over week, especially around runtime concerns and orchestration tradeoffs.';
		const ctx = makeContext({
			draft: makeDraft({
				platform: 'medium',
				body: longBody,
				metadata: { tags: ['runtime'], canonical_url: null }
			})
		});
		const out = fillPostSteps(ctx);

		const expectedTitle = longBody.slice(0, 80).trim();
		assert.ok(out.includes(expectedTitle), `expected title "${expectedTitle}" in output`);
	});

	it('renders the twitter template with thread_count from metadata', () => {
		const ctx = makeContext({
			draft: makeDraft({
				platform: 'twitter',
				body: '1/ Hook tweet\n\n2/ Detail tweet\n\n3/ Closing tweet',
				metadata: { thread_count: 3 }
			})
		});
		const out = fillPostSteps(ctx);

		assert.match(out, /thread of 3 tweets/);
		assert.match(out, /all 3 tweets are queued/);
	});

	it('defaults thread_count to 1 when metadata is missing it on a twitter draft', () => {
		const ctx = makeContext({
			draft: makeDraft({
				platform: 'twitter',
				body: 'Single tweet',
				metadata: {}
			})
		});
		const out = fillPostSteps(ctx);

		assert.match(out, /thread of 1 tweets/);
	});

	it('renders the hackernews template with title only and no scheduling placeholder', () => {
		const ctx = makeContext({
			draft: makeDraft({
				platform: 'hackernews',
				body: 'Show HN: a runtime for agents\n\nBuilt as the connective tissue between orchestration frameworks.',
				metadata: {}
			})
		});
		const out = fillPostSteps(ctx);

		assert.match(out, /news\.ycombinator\.com/);
		assert.match(out, /Title: Show HN: a runtime for agents/);
		assert.ok(!out.includes('{{schedule_time}}'), 'hackernews template has no schedule line');
	});

	it('throws on an unknown platform', () => {
		const ctx = makeContext({
			draft: makeDraft({ platform: 'mastodon' })
		});
		assert.throws(() => fillPostSteps(ctx), /no post-step template registered/);
	});

	it('covers every platform in POST_STEP_PLATFORM_LIST', () => {
		assert.equal(POST_STEP_PLATFORM_LIST.length, 7);
		for (const platform of POST_STEP_PLATFORM_LIST) {
			const ctx = makeContext({
				draft: makeDraft({
					platform,
					body: '# A reasonable title\n\nbody.',
					metadata:
						platform === 'twitter'
							? { thread_count: 5 }
							: platform === 'hashnode' || platform === 'medium' || platform === 'devto'
								? { tags: ['x'], canonical_url: null }
								: {}
				})
			});
			const out = fillPostSteps(ctx);
			assert.ok(out.length > 0, `template for ${platform} renders non-empty`);
			assert.ok(!out.includes('\u2014'), `${platform} template has no em-dash`);
		}
	});
});

describe('fillVoiceTransferPrompt', () => {
	it('embeds tone, sentence patterns, never-write, the platform name, and the draft body', () => {
		const out = fillVoiceTransferPrompt(makeContext());

		assert.match(out, /hashnode/);
		assert.match(out, /Direct, technical, concrete\./);
		assert.match(out, /Short declarative sentences\./);
		assert.match(out, /Never use em-dashes\./);
		assert.match(out, /Runtime is the layer/);
	});

	it('uses long-form samples when the platform is hashnode', () => {
		const ctx = makeContext({
			voice: makeVoice({
				'long-form': ['LONG_FORM_SAMPLE_BODY_42'],
				linkedin: ['LINKEDIN_SAMPLE_BODY_99']
			})
		});
		const out = fillVoiceTransferPrompt(ctx);

		assert.match(out, /LONG_FORM_SAMPLE_BODY_42/);
		assert.ok(!out.includes('LINKEDIN_SAMPLE_BODY_99'));
		assert.match(out, /### Sample 1/);
	});

	it('uses linkedin samples for a linkedin draft', () => {
		const ctx = makeContext({
			draft: makeDraft({ platform: 'linkedin', metadata: {} }),
			voice: makeVoice({
				'long-form': ['SHOULD_NOT_APPEAR'],
				linkedin: ['LINKEDIN_SAMPLE_A', 'LINKEDIN_SAMPLE_B']
			})
		});
		const out = fillVoiceTransferPrompt(ctx);

		assert.match(out, /LINKEDIN_SAMPLE_A/);
		assert.match(out, /LINKEDIN_SAMPLE_B/);
		assert.match(out, /### Sample 1/);
		assert.match(out, /### Sample 2/);
		assert.ok(!out.includes('SHOULD_NOT_APPEAR'));
	});

	it('renders "(no samples on file)" when the voice has no samples for the platform format', () => {
		const out = fillVoiceTransferPrompt(makeContext());

		assert.match(out, /\(no samples on file\)/);
	});
});

describe('fillTopicRefinementPrompt', () => {
	it('embeds report context, the angle, and the matched interpretation', () => {
		const out = fillTopicRefinementPrompt(makeContext());

		assert.match(out, /EXEC_SUMMARY_BODY/);
		assert.match(out, /SNAPSHOT_BODY/);
		assert.match(out, /CrewAI mentions doubled\./);
		assert.match(out, /Runtime is the layer that does not care which framework wins\./);
		assert.match(out, /Orchestration churn is real\./);
		assert.match(out, /Runtime positioning has room to land\./);
		assert.match(out, /Runtime is the layer/);
	});

	it('matches the interpretation whose signal contains the draft opportunity_signal', () => {
		const ctx = makeContext({
			draft: makeDraft({
				opportunitySignal: 'tool integration'
			})
		});
		const out = fillTopicRefinementPrompt(ctx);

		assert.match(out, /Tool integration is the unsolved runtime problem\./);
		assert.match(out, /Build content around runtime tool wiring\./);
		assert.ok(!out.includes('Orchestration churn is real.'));
	});

	it('falls back to the first interpretation when no signal matches', () => {
		const ctx = makeContext({
			draft: makeDraft({
				opportunitySignal: 'unrelated signal that does not match anything'
			})
		});
		const out = fillTopicRefinementPrompt(ctx);

		assert.match(out, /Orchestration churn is real\./);
	});

	it('uses fallback text when the report has no interpretations', () => {
		const ctx = makeContext({
			report: makeReport({ interpretations: [] }),
			draft: makeDraft({ opportunitySignal: 'CrewAI mentions doubled.' })
		});
		const out = fillTopicRefinementPrompt(ctx);

		assert.match(out, /Signal: CrewAI mentions doubled\./);
		assert.match(out, /Meaning: \(no interpretation captured\)/);
		assert.match(out, /Implication: \(no interpretation captured\)/);
	});

	it('does not contain em-dashes', () => {
		const out = fillTopicRefinementPrompt(makeContext());
		assert.ok(!out.includes('\u2014'));
	});
});
