import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OperatorContext } from '@pulsar/context';
import type {
	AppContext,
	BuildContextOptions,
	IntelligenceContext,
	ProductContext
} from '@pulsar/context/types';
import type { ReportData } from '@pulsar/shared/types';
import type { VoiceContext, VoiceFormat } from '@pulsar/voice';

import {
	type BuildContextFn,
	type InvokePipelineFn,
	type LoadOperatorContextFn,
	type LoadVoiceContextFn,
	type LogFn,
	type Phase3DraftRow,
	orchestrateContentRecommendations
} from '../lib/content-recommendations-orchestrator.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeOperatorContext(): OperatorContext {
	return {
		operatorName: 'Jane Doe',
		role: 'Founder',
		orgName: 'Acme Corp',
		domain: 'market-analysis',
		allowedGitHubLogins: ['janedoe'],
		groundingUrls: [],
		positioning: 'Acme is the reliability layer for backend systems.',
		audience: 'Senior backend engineers building production systems.',
		hardRules: ['No em-dashes anywhere. Use commas, colons, periods, parentheses.'],
		glossary: {},
		trackedEntities: { entities: [], keywords: [], technologies: [] }
	};
}

function makeVoiceContext(overrides: Partial<VoiceContext> = {}): VoiceContext {
	return {
		profile: {
			tone: 'Direct, technical, no marketing language.',
			sentencePatterns: 'Short sentences. Active voice.',
			neverWrite: 'Never write "leverage", "synergy", or "delve".',
			formats: ['long-form', 'linkedin', 'twitter']
		},
		samples: {
			'long-form': ['LONG_FORM_SAMPLE_A', 'LONG_FORM_SAMPLE_B'],
			linkedin: ['LINKEDIN_SAMPLE_A'],
			reddit: ['REDDIT_SAMPLE_A'],
			discord: ['DISCORD_SAMPLE_A'],
			twitter: ['TWITTER_SAMPLE_A'],
			other: ['OTHER_SAMPLE_A']
		},
		...overrides
	};
}

function makeIntelligenceContext(): IntelligenceContext {
	return {
		period: {
			start: new Date('2026-04-23T00:00:00.000Z'),
			end: new Date('2026-04-30T00:00:00.000Z')
		},
		graphSnapshotId: 'snap-1',
		graphSnapshotSource: 'cached',
		articleCount: 87,
		sourceCount: 12,
		entities: [
			{ name: 'MCP', type: 'Protocol', pagerankScore: 0.0421, pagerankRank: 4, mentionCount: 132 }
		],
		trendingKeywords: [{ keyword: 'mcp', count7d: 88, count30d: 220, delta: 0.42 }],
		topicClusters: [{ clusterId: 1, nodeCount: 14, topTopics: ['mcp', 'agents', 'tools'] }],
		topDiscussions: [
			{ title: 'MCP roundup', url: 'https://example.com/mcp', source: 'hn', commentCount: 312 }
		],
		sentimentBreakdown: { positive: 21, neutral: 60, negative: 6 },
		topAuthors: [{ handle: 'alice', platform: 'hn', articleCount: 7 }],
		emergingTopics: ['mcp', 'langgraph']
	};
}

function makeProductContext(): ProductContext {
	return {
		positioning: 'Reliability layer for backend agents.',
		packages: [{ name: '@acme/runtime', version: '1.4.0', summary: 'Core runtime.' }],
		groundingUrls: ['https://acme.example.com'],
		scrapedSiteContent: 'Acme runtime homepage content.'
	};
}

function makeReportData(): ReportData {
	return {
		reportMetadata: {
			periodStart: '2026-04-23T00:00:00.000Z',
			periodEnd: '2026-04-30T00:00:00.000Z',
			sourcesCount: 12,
			articleCount: 87
		},
		sections: {
			executiveSummary: { text: 'Executive summary text.' },
			marketSnapshot: { text: 'Market snapshot text.' },
			developerSignals: { text: 'Developer signals text.' },
			signalInterpretation: {
				text: 'Signal interpretation text.',
				interpretations: []
			},
			supportingResources: { resources: [] }
		},
		charts: {
			keywordDistribution: {
				windowStart: '2026-04-01T00:00:00.000Z',
				windowEnd: '2026-04-30T00:00:00.000Z',
				totalArticles: 87,
				buckets: []
			},
			entityCentrality: {
				currentPeriodEnd: '2026-04-30T00:00:00.000Z',
				periodKind: 'month',
				sparse: true,
				series: []
			}
		}
	};
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

type PipelineCall = {
	pipeName: 'angle-picker.pipe' | 'content-drafter.pipe';
	system: string;
	user: string;
};

type LogCall = {
	level: string;
	stage: string;
	message: string;
};

type LoadVoiceCall = { formats: VoiceFormat[] };

type HarnessOptions = {
	loadOperator?: LoadOperatorContextFn;
	voiceContexts?: VoiceContext[];
	intelligence?: IntelligenceContext;
	product?: ProductContext;
	contextThrows?: boolean;
	recommendationsResponse?: unknown;
	drafterResponses?: unknown[];
	insertThrows?: boolean;
};

function makeHarness(opts: HarnessOptions = {}) {
	const pipelineCalls: PipelineCall[] = [];
	const inserted: Phase3DraftRow[] = [];
	const logs: LogCall[] = [];
	const loadVoiceCalls: LoadVoiceCall[] = [];

	let drafterCallIndex = 0;

	const invokePipeline: InvokePipelineFn = async (_runId, pipeName, payload) => {
		pipelineCalls.push({ pipeName, system: payload.system, user: payload.user });
		if (pipeName === 'angle-picker.pipe') {
			return opts.recommendationsResponse ?? { recommendations: [], prioritizationNote: '' };
		}
		const responses = opts.drafterResponses ?? [];
		const response = responses[drafterCallIndex] ?? { platforms: [] };
		drafterCallIndex += 1;
		return response;
	};

	const log: LogFn = async (_runId, level, stage, message) => {
		logs.push({ level, stage, message });
	};

	const buildContext: BuildContextFn = async (
		options: BuildContextOptions
	): Promise<AppContext> => {
		if (opts.contextThrows) throw new Error('context build blew up');
		const ctx: AppContext = {};
		if (options.slices.includes('intelligence')) ctx.intelligence = opts.intelligence;
		if (options.slices.includes('product')) ctx.product = opts.product;
		return ctx;
	};

	const voiceContexts = opts.voiceContexts ?? [];
	let voiceCallIndex = 0;
	const loadVoice: LoadVoiceContextFn = (formats: VoiceFormat[]) => {
		loadVoiceCalls.push({ formats });
		const ctx = voiceContexts[voiceCallIndex] ?? makeVoiceContext();
		voiceCallIndex += 1;
		return ctx;
	};

	return {
		pipelineCalls,
		inserted,
		logs,
		loadVoiceCalls,
		deps: {
			loadOperator: opts.loadOperator ?? makeOperatorContext,
			loadVoice,
			buildContext,
			invokePipeline,
			insertDraft: async (row: Phase3DraftRow) => {
				if (opts.insertThrows) throw new Error('insert blew up');
				inserted.push(row);
			},
			log
		}
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('orchestrateContentRecommendations', () => {
	describe('skip paths', () => {
		it('skips when buildContext throws', async () => {
			const reportData = makeReportData();
			const h = makeHarness({ contextThrows: true });

			const result = await orchestrateContentRecommendations(h.deps, {
				runId: 'run-1',
				reportId: 'report-1',
				reportData
			});

			assert.equal(result.skipped, 'no-recommendations');
			assert.equal(result.recommendationCount, 0);
			assert.equal(result.draftCount, 0);
			assert.equal(h.pipelineCalls.length, 0, 'no pipeline calls when context unavailable');
			assert.equal(h.inserted.length, 0);
			const skipLog = h.logs.find((l) => l.message.includes('V2 context unavailable'));
			assert.ok(skipLog, 'expected V2 context skip log');
		});

		it('skips when intelligence slice is missing', async () => {
			const reportData = makeReportData();
			const h = makeHarness({
				intelligence: undefined,
				product: makeProductContext()
			});

			const result = await orchestrateContentRecommendations(h.deps, {
				runId: 'run-2',
				reportId: 'report-2',
				reportData
			});

			assert.equal(result.skipped, 'no-recommendations');
			assert.equal(h.pipelineCalls.length, 0);
		});

		it('skips when product slice is missing', async () => {
			const reportData = makeReportData();
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: undefined
			});

			const result = await orchestrateContentRecommendations(h.deps, {
				runId: 'run-3',
				reportId: 'report-3',
				reportData
			});

			assert.equal(result.skipped, 'no-recommendations');
			assert.equal(h.pipelineCalls.length, 0);
		});

		it('skips when pass 1 returns 0 recommendations', async () => {
			const reportData = makeReportData();
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: makeProductContext(),
				recommendationsResponse: { recommendations: [], prioritizationNote: 'nothing actionable' }
			});

			const result = await orchestrateContentRecommendations(h.deps, {
				runId: 'run-4',
				reportId: 'report-4',
				reportData
			});

			assert.equal(result.skipped, 'no-recommendations');
			assert.equal(result.recommendationCount, 0);
			assert.equal(result.prioritizationNote, 'nothing actionable');
			assert.equal(h.pipelineCalls.length, 1, 'pass 1 ran exactly once');
			assert.equal(h.pipelineCalls[0].pipeName, 'angle-picker.pipe');
			assert.equal(h.inserted.length, 0);
		});

		it('skips when pass 1 response is malformed', async () => {
			const reportData = makeReportData();
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: makeProductContext(),
				recommendationsResponse: 'not an object at all'
			});

			const result = await orchestrateContentRecommendations(h.deps, {
				runId: 'run-5',
				reportId: 'report-5',
				reportData
			});

			assert.equal(result.skipped, 'no-recommendations');
			assert.equal(h.inserted.length, 0);
			const malformedLog = h.logs.find((l) => l.message.includes('malformed'));
			assert.ok(malformedLog, 'expected malformed-response log');
		});
	});

	describe('happy path', () => {
		it('persists every platform variant returned by the drafter', async () => {
			const reportData = makeReportData();
			const recommendationsResponse = {
				recommendations: [
					{
						title: 'MCP is the connective tissue',
						format: 'blog-post',
						signal: 'MCP rank 4, pagerank 0.0421, mentions 132',
						angle: 'Tooling is consolidating around MCP.',
						target: 'Senior backend engineers shipping agents.',
						whyNow: 'Mentions tripled vs last month.'
					},
					{
						title: 'Framework churn slowing',
						format: 'social-thread',
						signal: 'LangGraph stable releases dropped 40 percent.',
						angle: 'Maturation phase: pick a runtime and ship.',
						target: 'Tech leads evaluating agent frameworks.',
						whyNow: 'Release cadence flipped this period.'
					}
				],
				prioritizationNote: 'Lead with MCP, follow with the maturity piece.'
			};
			const drafterResponses = [
				{
					platforms: [
						{
							platform: 'medium',
							content: 'medium body',
							metadata: { tags: ['mcp'], canonical_url: null }
						},
						{ platform: 'linkedin', content: 'linkedin body', metadata: {} }
					]
				},
				{
					platforms: [
						{ platform: 'twitter', content: 'twitter body', metadata: { thread_count: 5 } }
					]
				}
			];
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: makeProductContext(),
				recommendationsResponse,
				drafterResponses
			});

			const result = await orchestrateContentRecommendations(h.deps, {
				runId: 'run-6',
				reportId: 'report-6',
				reportData
			});

			assert.equal(result.skipped, null);
			assert.equal(result.recommendationCount, 2);
			assert.equal(result.draftCount, 3);
			assert.equal(result.prioritizationNote, 'Lead with MCP, follow with the maturity piece.');
			assert.equal(h.inserted.length, 3);

			const platforms = h.inserted.map((r) => r.platform).sort();
			assert.deepEqual(platforms, ['linkedin', 'medium', 'twitter']);

			// title/format/target/why_now propagate to every row.
			const mediumRow = h.inserted.find((r) => r.platform === 'medium');
			assert.ok(mediumRow);
			assert.equal(mediumRow.title, 'MCP is the connective tissue');
			assert.equal(mediumRow.format, 'blog-post');
			assert.equal(mediumRow.target, 'Senior backend engineers shipping agents.');
			assert.equal(mediumRow.whyNow, 'Mentions tripled vs last month.');
			assert.equal(mediumRow.angle, 'Tooling is consolidating around MCP.');
			assert.equal(mediumRow.opportunitySignal, 'MCP rank 4, pagerank 0.0421, mentions 132');
			assert.equal(mediumRow.runId, 'run-6');
			assert.equal(mediumRow.reportId, 'report-6');

			const twitterRow = h.inserted.find((r) => r.platform === 'twitter');
			assert.ok(twitterRow);
			assert.equal(twitterRow.format, 'social-thread');
			assert.deepEqual(twitterRow.metadata, { thread_count: 5 });
		});

		it('derives content_type by platform family', async () => {
			const reportData = makeReportData();
			const recommendationsResponse = {
				recommendations: [
					{
						title: 'T',
						format: 'blog-post',
						signal: 'sig',
						angle: 'angle',
						target: 'target',
						whyNow: 'now'
					}
				],
				prioritizationNote: ''
			};
			const drafterResponses = [
				{
					platforms: [
						{ platform: 'medium', content: 'medium body', metadata: {} },
						{ platform: 'linkedin', content: 'linkedin body', metadata: {} }
					]
				}
			];
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: makeProductContext(),
				recommendationsResponse,
				drafterResponses
			});

			await orchestrateContentRecommendations(h.deps, {
				runId: 'run-7',
				reportId: 'report-7',
				reportData
			});

			const byPlatform = new Map(h.inserted.map((r) => [r.platform, r.contentType]));
			assert.equal(byPlatform.get('medium'), 'long-form');
			assert.equal(byPlatform.get('linkedin'), 'social');
		});
	});

	describe('voice scoping (pass 2)', () => {
		it('loads voice formats matching the recommendation format', async () => {
			const reportData = makeReportData();
			const recommendationsResponse = {
				recommendations: [
					{
						title: 'T',
						format: 'blog-post',
						signal: 'sig',
						angle: 'angle',
						target: 'target',
						whyNow: 'now'
					}
				],
				prioritizationNote: ''
			};
			const drafterResponses = [
				{
					platforms: [{ platform: 'medium', content: 'medium body', metadata: {} }]
				}
			];
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: makeProductContext(),
				recommendationsResponse,
				drafterResponses
			});

			await orchestrateContentRecommendations(h.deps, {
				runId: 'run-8',
				reportId: 'report-8',
				reportData
			});

			// First loadVoice call is pass 1 with formats=[].
			assert.deepEqual(h.loadVoiceCalls[0].formats, []);
			// Second loadVoice call is pass 2 for the blog-post recommendation:
			// blog-post -> [hashnode, medium, devto, linkedin] -> voice formats
			// long-form (hashnode/medium/devto) + linkedin.
			assert.deepEqual(h.loadVoiceCalls[1].formats, ['long-form', 'linkedin']);
		});

		it('only injects samples for the recommendation-scoped voice formats', async () => {
			const reportData = makeReportData();
			const recommendationsResponse = {
				recommendations: [
					{
						title: 'T',
						format: 'blog-post',
						signal: 'sig',
						angle: 'angle',
						target: 'target',
						whyNow: 'now'
					}
				],
				prioritizationNote: ''
			};
			const drafterResponses = [
				{
					platforms: [{ platform: 'medium', content: 'medium body', metadata: {} }]
				}
			];
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: makeProductContext(),
				recommendationsResponse,
				drafterResponses
			});

			await orchestrateContentRecommendations(h.deps, {
				runId: 'run-9',
				reportId: 'report-9',
				reportData
			});

			const drafterCall = h.pipelineCalls.find((c) => c.pipeName === 'content-drafter.pipe');
			assert.ok(drafterCall, 'expected a drafter call');
			assert.match(drafterCall.system, /LONG_FORM_SAMPLE_A/);
			assert.match(drafterCall.system, /LINKEDIN_SAMPLE_A/);
			assert.doesNotMatch(drafterCall.system, /TWITTER_SAMPLE_A/);
			assert.doesNotMatch(drafterCall.system, /DISCORD_SAMPLE_A/);
			assert.doesNotMatch(drafterCall.system, /REDDIT_SAMPLE_A/);
		});
	});

	describe('per-recommendation invocation', () => {
		it('fires pass 2 once per recommendation', async () => {
			const reportData = makeReportData();
			const recommendationsResponse = {
				recommendations: [
					{
						title: 'A',
						format: 'blog-post',
						signal: 'sig-a',
						angle: 'angle-a',
						target: 'target-a',
						whyNow: 'now-a'
					},
					{
						title: 'B',
						format: 'social-thread',
						signal: 'sig-b',
						angle: 'angle-b',
						target: 'target-b',
						whyNow: 'now-b'
					},
					{
						title: 'C',
						format: 'short-post',
						signal: 'sig-c',
						angle: 'angle-c',
						target: 'target-c',
						whyNow: 'now-c'
					}
				],
				prioritizationNote: ''
			};
			const drafterResponses = [
				{ platforms: [{ platform: 'medium', content: 'a body', metadata: {} }] },
				{ platforms: [{ platform: 'twitter', content: 'b body', metadata: {} }] },
				{ platforms: [{ platform: 'linkedin', content: 'c body', metadata: {} }] }
			];
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: makeProductContext(),
				recommendationsResponse,
				drafterResponses
			});

			const result = await orchestrateContentRecommendations(h.deps, {
				runId: 'run-10',
				reportId: 'report-10',
				reportData
			});

			const drafterCalls = h.pipelineCalls.filter((c) => c.pipeName === 'content-drafter.pipe');
			assert.equal(drafterCalls.length, 3);
			assert.equal(result.recommendationCount, 3);
			assert.equal(result.draftCount, 3);
		});
	});

	describe('platform filtering', () => {
		it('drops drafter platforms outside the format candidate set', async () => {
			const reportData = makeReportData();
			const recommendationsResponse = {
				recommendations: [
					{
						title: 'T',
						format: 'social-thread',
						signal: 'sig',
						angle: 'angle',
						target: 'target',
						whyNow: 'now'
					}
				],
				prioritizationNote: ''
			};
			// social-thread maps to ['twitter']. Drafter returns twitter (kept) and
			// medium (dropped, not in candidate set for social-thread).
			const drafterResponses = [
				{
					platforms: [
						{ platform: 'twitter', content: 'twitter body', metadata: { thread_count: 4 } },
						{ platform: 'medium', content: 'medium body', metadata: {} }
					]
				}
			];
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: makeProductContext(),
				recommendationsResponse,
				drafterResponses
			});

			const result = await orchestrateContentRecommendations(h.deps, {
				runId: 'run-11',
				reportId: 'report-11',
				reportData
			});

			assert.equal(result.draftCount, 1);
			assert.equal(h.inserted.length, 1);
			assert.equal(h.inserted[0].platform, 'twitter');
			const dropLog = h.logs.find(
				(l) => l.level === 'warn' && l.message.includes("unexpected platform 'medium'")
			);
			assert.ok(dropLog, 'expected an unexpected-platform warn log');
		});
	});

	describe('parsing tolerance', () => {
		it('parses { drafts: [{ platforms }] } drift shape', async () => {
			const reportData = makeReportData();
			const recommendationsResponse = {
				recommendations: [
					{
						title: 'T',
						format: 'blog-post',
						signal: 'sig',
						angle: 'angle',
						target: 'target',
						whyNow: 'now'
					}
				],
				prioritizationNote: ''
			};
			const drafterResponses = [
				{
					drafts: [
						{
							platforms: [
								{ platform: 'medium', content: 'medium body', metadata: {} },
								{ platform: 'linkedin', content: 'linkedin body', metadata: {} }
							]
						}
					]
				}
			];
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: makeProductContext(),
				recommendationsResponse,
				drafterResponses
			});

			const result = await orchestrateContentRecommendations(h.deps, {
				runId: 'run-12',
				reportId: 'report-12',
				reportData
			});

			assert.equal(result.draftCount, 2);
			const platforms = h.inserted.map((r) => r.platform).sort();
			assert.deepEqual(platforms, ['linkedin', 'medium']);
		});

		it('parses a flat array drafter response', async () => {
			const reportData = makeReportData();
			const recommendationsResponse = {
				recommendations: [
					{
						title: 'T',
						format: 'blog-post',
						signal: 'sig',
						angle: 'angle',
						target: 'target',
						whyNow: 'now'
					}
				],
				prioritizationNote: ''
			};
			const drafterResponses = [
				[
					{ platform: 'medium', content: 'medium body', metadata: {} },
					{ platform: 'linkedin', content: 'linkedin body', metadata: {} }
				]
			];
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: makeProductContext(),
				recommendationsResponse,
				drafterResponses
			});

			const result = await orchestrateContentRecommendations(h.deps, {
				runId: 'run-13',
				reportId: 'report-13',
				reportData
			});

			assert.equal(result.draftCount, 2);
		});

		it('drops recommendations missing required fields', async () => {
			const reportData = makeReportData();
			const recommendationsResponse = {
				recommendations: [
					// good
					{
						title: 'T',
						format: 'blog-post',
						signal: 'sig',
						angle: 'angle',
						target: 'target',
						whyNow: 'now'
					},
					// missing title
					{ format: 'blog-post', signal: 's', angle: 'a', target: 't', whyNow: 'n' },
					// invalid format
					{
						title: 'T2',
						format: 'something-else',
						signal: 's',
						angle: 'a',
						target: 't',
						whyNow: 'n'
					}
				],
				prioritizationNote: ''
			};
			const drafterResponses = [
				{ platforms: [{ platform: 'medium', content: 'medium body', metadata: {} }] }
			];
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: makeProductContext(),
				recommendationsResponse,
				drafterResponses
			});

			const result = await orchestrateContentRecommendations(h.deps, {
				runId: 'run-14',
				reportId: 'report-14',
				reportData
			});

			assert.equal(result.recommendationCount, 1);
			assert.equal(result.draftCount, 1);
		});
	});

	describe('all drafters returning nothing', () => {
		it('returns no-drafts when every recommendation yields zero variants', async () => {
			const reportData = makeReportData();
			const recommendationsResponse = {
				recommendations: [
					{
						title: 'T',
						format: 'blog-post',
						signal: 'sig',
						angle: 'angle',
						target: 'target',
						whyNow: 'now'
					}
				],
				prioritizationNote: 'note'
			};
			const drafterResponses = [{ platforms: [] }];
			const h = makeHarness({
				intelligence: makeIntelligenceContext(),
				product: makeProductContext(),
				recommendationsResponse,
				drafterResponses
			});

			const result = await orchestrateContentRecommendations(h.deps, {
				runId: 'run-15',
				reportId: 'report-15',
				reportData
			});

			assert.equal(result.skipped, 'no-drafts');
			assert.equal(result.recommendationCount, 1);
			assert.equal(result.draftCount, 0);
			assert.equal(result.prioritizationNote, 'note');
			const zeroLog = h.logs.find((l) => l.message.includes('returned 0 drafts'));
			assert.ok(zeroLog);
		});
	});
});
