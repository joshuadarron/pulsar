import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OperatorContext } from '@pulsar/context';
import type { IntelligenceContext, ProductContext } from '@pulsar/context/types';
import type { ContentFormat, ContentRecommendation } from '@pulsar/shared/types';
import { ALL_CONTENT_FORMATS } from '@pulsar/shared/types';
import type { VoiceContext, VoiceFormat } from '@pulsar/voice';

import { type ContentPlatform, PLATFORM_FORMAT_SPECS } from '../prompts/content-drafts.js';
import {
	FORMAT_TO_PLATFORMS,
	buildDrafterV2SystemPrompt,
	buildDrafterV2UserPrompt,
	buildRecommendationSystemPrompt,
	buildRecommendationUserPrompt,
	voiceFormatsForContentFormat
} from '../prompts/content-recommendations.js';

function makeStubContext(overrides: Partial<OperatorContext> = {}): OperatorContext {
	return {
		operatorName: 'Jane Doe',
		role: 'Founder',
		orgName: 'Acme Corp',
		domain: 'market-analysis',
		allowedGitHubLogins: ['janedoe'],
		groundingUrls: ['https://acme.example.com', 'https://docs.acme.example.com'],
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

function makeStubIntelligence(overrides: Partial<IntelligenceContext> = {}): IntelligenceContext {
	return {
		period: {
			start: new Date('2026-04-01T00:00:00Z'),
			end: new Date('2026-04-30T00:00:00Z')
		},
		graphSnapshotId: 'snap_001',
		graphSnapshotSource: 'cached',
		articleCount: 1234,
		sourceCount: 12,
		entities: [
			{
				name: 'CrewAI',
				type: 'framework',
				pagerankScore: 0.9876,
				pagerankRank: 1,
				mentionCount: 421,
				history: {
					twelveMonthDelta: 0.42,
					yoyDelta: 1.1,
					trajectory: [
						{ period: '2026-03', mentions: 200, centrality: 0.5 },
						{ period: '2026-04', mentions: 421, centrality: 0.9876 }
					]
				}
			},
			{
				name: 'LangGraph',
				type: 'framework',
				pagerankScore: 0.8123,
				pagerankRank: 2,
				mentionCount: 309
			}
		],
		trendingKeywords: [
			{ keyword: 'tool-use', count7d: 88, count30d: 240, delta: 0.55, velocitySpike: 2.3 },
			{ keyword: 'orchestration', count7d: 60, count30d: 200, delta: 0.21 }
		],
		topicClusters: [{ clusterId: 7, nodeCount: 42, topTopics: ['agents', 'tools', 'memory'] }],
		topDiscussions: [
			{
				title: 'Tool integration is the unsolved runtime problem',
				url: 'https://reddit.example/post/1',
				source: 'reddit',
				commentCount: 147
			}
		],
		sentimentBreakdown: { positive: 0.42, neutral: 0.5, negative: 0.08 },
		topAuthors: [{ handle: 'alice', platform: 'hashnode', articleCount: 9 }],
		emergingTopics: ['agentic-rag', 'self-correcting-tools'],
		...overrides
	};
}

function makeStubProduct(overrides: Partial<ProductContext> = {}): ProductContext {
	return {
		positioning: 'Acme is the reliability layer for backend systems.',
		packages: [{ name: '@acme/runtime', version: '1.4.0', summary: 'Acme runtime kernel.' }],
		groundingUrls: ['https://acme.example.com'],
		scrapedSiteContent: 'Acme builds the reliability layer. '.repeat(50),
		...overrides
	};
}

const reportSections = {
	executiveSummary: 'EXEC_SUMMARY_BODY',
	marketSnapshot: 'SNAPSHOT_BODY',
	developerSignals: 'DEV_SIGNAL_BODY',
	signalInterpretation: 'INTERPRETATION_BODY'
};

describe('buildRecommendationSystemPrompt', () => {
	it('includes operator identity, positioning, audience, hard rules, and grounding URLs', () => {
		const prompt = buildRecommendationSystemPrompt(makeStubContext(), makeStubVoice());

		assert.match(prompt, /Acme Corp/);
		assert.match(prompt, /Jane Doe/);
		assert.match(prompt, /Acme is the reliability layer for backend systems\./);
		assert.match(prompt, /Senior backend and platform engineers/);
		assert.match(prompt, /No em-dashes anywhere\./);
		assert.match(prompt, /Acme is a runtime, not a platform\./);
		assert.match(prompt, /https:\/\/acme\.example\.com/);
		assert.match(prompt, /https:\/\/docs\.acme\.example\.com/);
	});

	it('embeds the voice profile but not voice samples and stays operator-agnostic', () => {
		const voice = makeStubVoice({
			samples: {
				'long-form': ['UNIQUE_LONGFORM_SAMPLE_BODY_99'],
				linkedin: ['UNIQUE_LINKEDIN_SAMPLE_BODY_99'],
				reddit: [],
				discord: [],
				twitter: [],
				other: []
			}
		});
		const prompt = buildRecommendationSystemPrompt(makeStubContext(), voice);

		assert.match(prompt, /Direct, technical, concrete\./);
		assert.match(prompt, /Short declarative sentences\./);
		assert.match(prompt, /Never use em-dashes\./);
		assert.ok(!prompt.includes('UNIQUE_LONGFORM_SAMPLE_BODY_99'));
		assert.ok(!prompt.includes('UNIQUE_LINKEDIN_SAMPLE_BODY_99'));
		assert.ok(!prompt.includes('RocketRide'));
		assert.ok(!prompt.includes('rocketride.ai'));
		assert.ok(!prompt.includes('\u2014'), 'recommendation system prompt contains an em-dash');
	});

	it('declares "at least 4 recommendations, no upper bound" and the EXACT NUMBERS rule for signals', () => {
		const prompt = buildRecommendationSystemPrompt(makeStubContext(), makeStubVoice());

		assert.match(prompt, /at least 4 recommendations/i);
		assert.match(prompt, /No upper bound/i);
		assert.match(prompt, /EXACT NUMBERS/);
		assert.match(prompt, /PageRank/);
		assert.match(prompt, /comment count/);
	});

	it('declares the ContentRecommendationsArtifact output contract with all six format values', () => {
		const prompt = buildRecommendationSystemPrompt(makeStubContext(), makeStubVoice());

		assert.match(prompt, /"recommendations":/);
		assert.match(prompt, /"prioritizationNote":/);
		assert.match(prompt, /"title":/);
		assert.match(prompt, /"format":/);
		assert.match(prompt, /"signal":/);
		assert.match(prompt, /"angle":/);
		assert.match(prompt, /"target":/);
		assert.match(prompt, /"whyNow":/);
		for (const format of ALL_CONTENT_FORMATS) {
			assert.ok(
				prompt.includes(format),
				`recommendation system prompt should mention format ${format}`
			);
		}
	});
});

describe('buildRecommendationUserPrompt', () => {
	it('renders intelligence numbers verbatim (PageRank, comment counts, deltas) and report sections', () => {
		const intelligence = makeStubIntelligence();
		const product = makeStubProduct();
		const prompt = buildRecommendationUserPrompt({ intelligence, product, reportSections });

		// PageRank scores and ranks
		assert.match(prompt, /CrewAI/);
		assert.match(prompt, /pagerank=0\.9876/);
		assert.match(prompt, /rank=1/);
		assert.match(prompt, /mentions=421/);
		assert.match(prompt, /trajectory=2026-03:200,2026-04:421/);

		// Trending keyword counts
		assert.match(prompt, /tool-use/);
		assert.match(prompt, /count7d=88/);
		assert.match(prompt, /count30d=240/);
		assert.match(prompt, /velocitySpike=2\.3/);

		// Discussion comment count
		assert.match(prompt, /147 comments/);

		// Sentiment breakdown
		assert.match(prompt, /positive=0\.42/);
		assert.match(prompt, /negative=0\.08/);

		// Article and source counts
		assert.match(prompt, /articleCount: 1234/);
		assert.match(prompt, /sourceCount: 12/);

		// Emerging topics
		assert.match(prompt, /agentic-rag/);

		// Report sections present but flagged as framing reference
		assert.match(prompt, /EXEC_SUMMARY_BODY/);
		assert.match(prompt, /SNAPSHOT_BODY/);
		assert.match(prompt, /DEV_SIGNAL_BODY/);
		assert.match(prompt, /INTERPRETATION_BODY/);
		assert.match(prompt, /source of truth/);
	});

	it('truncates scraped site content beyond ~3000 chars and embeds product positioning + packages', () => {
		const intelligence = makeStubIntelligence();
		const product = makeStubProduct({
			scrapedSiteContent: 'X'.repeat(5000)
		});
		const prompt = buildRecommendationUserPrompt({ intelligence, product, reportSections });

		assert.match(prompt, /Acme is the reliability layer for backend systems\./);
		assert.match(prompt, /@acme\/runtime@1\.4\.0/);
		assert.match(prompt, /\[truncated at 3000 chars\]/);
		// The 5000-char run should not appear in full
		assert.ok(!prompt.includes('X'.repeat(3500)));
	});
});

describe('FORMAT_TO_PLATFORMS', () => {
	it('returns the documented mapping for each of the six content formats', () => {
		const expected: Record<ContentFormat, ContentPlatform[]> = {
			'blog-post': ['hashnode', 'medium', 'devto', 'linkedin'],
			tutorial: ['medium', 'devto', 'hashnode'],
			'medium-piece': ['medium'],
			'social-thread': ['twitter'],
			'video-tutorial': ['medium'],
			'short-post': ['linkedin', 'twitter', 'discord']
		};
		for (const format of ALL_CONTENT_FORMATS) {
			assert.deepEqual(FORMAT_TO_PLATFORMS[format], expected[format]);
		}
	});
});

describe('voiceFormatsForContentFormat', () => {
	it('collapses platforms onto deduplicated voice formats', () => {
		// blog-post -> hashnode, medium, devto, linkedin
		// hashnode/medium/devto all map to long-form; linkedin maps to linkedin.
		assert.deepEqual(voiceFormatsForContentFormat('blog-post'), ['long-form', 'linkedin']);
		assert.deepEqual(voiceFormatsForContentFormat('tutorial'), ['long-form']);
		assert.deepEqual(voiceFormatsForContentFormat('medium-piece'), ['long-form']);
		assert.deepEqual(voiceFormatsForContentFormat('social-thread'), ['twitter']);
		assert.deepEqual(voiceFormatsForContentFormat('video-tutorial'), ['long-form']);
		assert.deepEqual(voiceFormatsForContentFormat('short-post'), [
			'linkedin',
			'twitter',
			'discord'
		]);
	});
});

describe('buildDrafterV2SystemPrompt', () => {
	it('embeds samples, restricts format specs to the platforms whose voice formats have samples', () => {
		// short-post -> linkedin, twitter, discord; supply samples for those voice formats only.
		const samples: Partial<Record<VoiceFormat, string[]>> = {
			linkedin: ['UNIQUE_LINKEDIN_SAMPLE_BODY_77'],
			twitter: ['UNIQUE_TWITTER_SAMPLE_BODY_77'],
			discord: ['UNIQUE_DISCORD_SAMPLE_BODY_77']
		};
		const prompt = buildDrafterV2SystemPrompt(makeStubContext(), makeStubVoice(), samples);

		// Samples embedded
		assert.match(prompt, /UNIQUE_LINKEDIN_SAMPLE_BODY_77/);
		assert.match(prompt, /UNIQUE_TWITTER_SAMPLE_BODY_77/);
		assert.match(prompt, /UNIQUE_DISCORD_SAMPLE_BODY_77/);

		// Format specs only for the active platforms
		assert.ok(prompt.includes(PLATFORM_FORMAT_SPECS.linkedin));
		assert.ok(prompt.includes(PLATFORM_FORMAT_SPECS.twitter));
		assert.ok(prompt.includes(PLATFORM_FORMAT_SPECS.discord));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.hashnode));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.medium));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.devto));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.hackernews));

		// Operator identity present, RocketRide absent
		assert.match(prompt, /Acme Corp/);
		assert.ok(!prompt.includes('RocketRide'));

		// Output contract: NOT wrapped in drafts array
		assert.match(prompt, /"platforms":/);
		assert.ok(!/"drafts":\s*\[/.test(prompt), 'V2 drafter must NOT wrap output in a drafts array');

		// Hard rules + no em-dashes
		assert.match(prompt, /No em-dashes anywhere\./);
		assert.ok(!prompt.includes('\u2014'), 'V2 drafter system prompt contains an em-dash');
	});

	it('only emits long-form-related specs when only long-form samples are provided', () => {
		const samples: Partial<Record<VoiceFormat, string[]>> = {
			'long-form': ['LONG_FORM_SAMPLE_BODY_55']
		};
		const prompt = buildDrafterV2SystemPrompt(makeStubContext(), makeStubVoice(), samples);

		assert.ok(prompt.includes(PLATFORM_FORMAT_SPECS.hashnode));
		assert.ok(prompt.includes(PLATFORM_FORMAT_SPECS.medium));
		assert.ok(prompt.includes(PLATFORM_FORMAT_SPECS.devto));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.linkedin));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.twitter));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.discord));
		assert.ok(!prompt.includes(PLATFORM_FORMAT_SPECS.hackernews));
	});
});

describe('buildDrafterV2UserPrompt', () => {
	it('echoes the recommendation in full and lists the candidate platforms for the format', () => {
		const recommendation: ContentRecommendation = {
			title: 'Tool wiring is unsolved at the runtime layer',
			format: 'short-post',
			signal: 'r/LocalLLaMA thread on tool integration hit 147 comments.',
			angle: 'Runtime tool integration is the bottleneck, not framework choice.',
			target: 'Backend engineers shipping agent systems to production.',
			whyNow: 'CrewAI mentions doubled this period; the question is breaking surface now.',
			priorityHint: 'now'
		};
		const prompt = buildDrafterV2UserPrompt({
			recommendation,
			reportContext: { executiveSummary: 'Exec summary.', marketSnapshot: 'Snapshot.' }
		});

		assert.match(prompt, /Tool wiring is unsolved at the runtime layer/);
		assert.match(prompt, /short-post/);
		assert.match(prompt, /r\/LocalLLaMA thread on tool integration hit 147 comments\./);
		assert.match(prompt, /Runtime tool integration is the bottleneck, not framework choice\./);
		assert.match(prompt, /Backend engineers shipping agent systems to production\./);
		assert.match(prompt, /CrewAI mentions doubled this period/);
		assert.match(prompt, /priorityHint: now/);

		// Active platforms list matches FORMAT_TO_PLATFORMS for short-post
		assert.match(prompt, /linkedin, twitter, discord/);
		assert.match(prompt, /Exec summary\./);
		assert.match(prompt, /Snapshot\./);
		assert.ok(!prompt.includes('\u2014'));
	});
});
