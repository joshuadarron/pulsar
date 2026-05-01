import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OperatorContext } from '@pulsar/context';
import type { ReportData } from '@pulsar/shared/types';
import type { VoiceContext, VoiceFormat } from '@pulsar/voice';

import {
	type ContentDraftRow,
	type InvokePipelineFn,
	type LoadOperatorContextFn,
	type LoadVoiceContextFn,
	type LogFn,
	orchestrateContentDrafts
} from '../lib/content-drafts-orchestrator.js';

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

function makeReportData(
	overrides: {
		interpretations?: ReportData['sections']['signalInterpretation']['interpretations'];
	} = {}
): ReportData {
	return {
		reportMetadata: {
			periodStart: '2026-04-23T00:00:00.000Z',
			periodEnd: '2026-04-30T00:00:00.000Z',
			sourcesCount: 12,
			articleCount: 87
		},
		sections: {
			executiveSummary: {
				text: 'Executive summary text used by both passes for grounding.'
			},
			marketSnapshot: {
				text: 'Market snapshot covering the last seven days of activity.'
			},
			developerSignals: {
				text: 'Developer signals covering sentiment and discussion patterns.'
			},
			signalInterpretation: {
				text: 'Three interpretations rose to angle quality this week.',
				interpretations: overrides.interpretations ?? [
					{
						signal: 'MCP at rank 4 with 3x mentions vs last month',
						meaning: 'Tooling is consolidating around MCP as the agent-tool bridge.',
						implication: 'Operator should ship MCP examples in onboarding flows.'
					},
					{
						signal: 'LangGraph stable releases dropped 40 percent this period',
						meaning: 'Framework churn is slowing, ecosystem entering maturation.',
						implication: 'Position the runtime as ecosystem-stable in messaging.'
					}
				]
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
// Test harness: collects calls to deps so assertions can inspect them
// ---------------------------------------------------------------------------

interface PipelineCall {
	pipeName: string;
	system: string;
	user: string;
}

interface LogCall {
	level: string;
	stage: string;
	message: string;
}

function makeHarness(opts: {
	loadOperator?: LoadOperatorContextFn;
	loadVoice?: LoadVoiceContextFn;
	angleResponse?: unknown;
	drafterResponse?: unknown;
	insertThrows?: boolean;
}) {
	const pipelineCalls: PipelineCall[] = [];
	const inserted: ContentDraftRow[] = [];
	const logs: LogCall[] = [];

	const invokePipeline: InvokePipelineFn = async (_runId, pipeName, payload) => {
		pipelineCalls.push({ pipeName, system: payload.system, user: payload.user });
		if (pipeName === 'angle-picker.pipe') {
			return opts.angleResponse ?? { angles: [] };
		}
		return opts.drafterResponse ?? { drafts: [] };
	};

	const log: LogFn = async (_runId, level, stage, message) => {
		logs.push({ level, stage, message });
	};

	return {
		pipelineCalls,
		inserted,
		logs,
		deps: {
			loadOperator: opts.loadOperator ?? makeOperatorContext,
			loadVoice: opts.loadVoice ?? ((_formats: VoiceFormat[]) => makeVoiceContext()),
			invokePipeline,
			insertDraft: async (row: ContentDraftRow) => {
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

describe('orchestrateContentDrafts', () => {
	describe('skip paths', () => {
		it('skips with a log when signalInterpretation has zero interpretations', async () => {
			const reportData = makeReportData({ interpretations: [] });
			const h = makeHarness({});

			const result = await orchestrateContentDrafts(h.deps, {
				runId: 'run-1',
				reportId: 'report-1',
				reportData
			});

			assert.equal(result.skipped, 'no-interpretations');
			assert.equal(result.angleCount, 0);
			assert.equal(result.draftCount, 0);
			assert.equal(h.pipelineCalls.length, 0, 'no pipeline calls when skipped');
			assert.equal(h.inserted.length, 0, 'no DB inserts when skipped');

			const skipLog = h.logs.find((l) => l.message.includes('No interpretations'));
			assert.ok(skipLog, 'expected a skip log');
		});

		it('skips pass 2 with a log when angle picker returns 0 angles', async () => {
			const reportData = makeReportData();
			const h = makeHarness({ angleResponse: { angles: [] } });

			const result = await orchestrateContentDrafts(h.deps, {
				runId: 'run-2',
				reportId: 'report-2',
				reportData
			});

			assert.equal(result.skipped, 'no-angles');
			assert.equal(result.angleCount, 0);
			assert.equal(result.draftCount, 0);
			assert.equal(h.pipelineCalls.length, 1, 'pass 1 ran exactly once');
			assert.equal(h.pipelineCalls[0].pipeName, 'angle-picker.pipe');
			assert.equal(h.inserted.length, 0, 'no DB inserts when no angles');

			const skipLog = h.logs.find((l) => l.message.includes('0 angles'));
			assert.ok(skipLog, 'expected a no-angles skip log');
		});
	});

	describe('happy path', () => {
		it('persists every platform variant returned by the drafter', async () => {
			const reportData = makeReportData();
			const angleResponse = {
				angles: [
					{
						opportunity_signal: 'MCP signal',
						angle: 'MCP is the connective tissue your stack is missing',
						platforms: ['medium', 'linkedin']
					},
					{
						opportunity_signal: 'LangGraph signal',
						angle: 'Framework churn is slowing',
						platforms: ['twitter']
					}
				]
			};
			const drafterResponse = {
				drafts: [
					{
						opportunity_signal: 'MCP signal',
						angle: 'MCP is the connective tissue your stack is missing',
						platforms: [
							{
								platform: 'medium',
								content: 'medium body',
								metadata: { tags: ['mcp', 'agents'], canonical_url: null }
							},
							{
								platform: 'linkedin',
								content: 'linkedin body',
								metadata: {}
							}
						]
					},
					{
						opportunity_signal: 'LangGraph signal',
						angle: 'Framework churn is slowing',
						platforms: [
							{
								platform: 'twitter',
								content: 'twitter body',
								metadata: { thread_count: 6 }
							}
						]
					}
				]
			};
			const h = makeHarness({ angleResponse, drafterResponse });

			const result = await orchestrateContentDrafts(h.deps, {
				runId: 'run-3',
				reportId: 'report-3',
				reportData
			});

			assert.equal(result.skipped, null);
			assert.equal(result.angleCount, 2);
			assert.equal(result.draftCount, 3);
			assert.equal(h.inserted.length, 3);

			const platforms = h.inserted.map((r) => r.platform).sort();
			assert.deepEqual(platforms, ['linkedin', 'medium', 'twitter']);
		});

		it('writes the angle and opportunity_signal onto every inserted row', async () => {
			const reportData = makeReportData();
			const angleResponse = {
				angles: [
					{
						opportunity_signal: 'MCP signal',
						angle: 'MCP is the connective tissue',
						platforms: ['medium']
					}
				]
			};
			const drafterResponse = {
				drafts: [
					{
						opportunity_signal: 'MCP signal',
						angle: 'MCP is the connective tissue',
						platforms: [
							{
								platform: 'medium',
								content: 'medium body',
								metadata: { tags: ['mcp'], canonical_url: null }
							}
						]
					}
				]
			};
			const h = makeHarness({ angleResponse, drafterResponse });

			await orchestrateContentDrafts(h.deps, {
				runId: 'run-4',
				reportId: 'report-4',
				reportData
			});

			assert.equal(h.inserted.length, 1);
			assert.equal(h.inserted[0].angle, 'MCP is the connective tissue');
			assert.equal(h.inserted[0].opportunitySignal, 'MCP signal');
			assert.deepEqual(h.inserted[0].metadata, { tags: ['mcp'], canonical_url: null });
			assert.equal(h.inserted[0].runId, 'run-4');
			assert.equal(h.inserted[0].reportId, 'report-4');
		});

		it('derives content_type by platform family (long-form vs social)', async () => {
			const reportData = makeReportData();
			const angleResponse = {
				angles: [
					{
						opportunity_signal: 'sig',
						angle: 'angle',
						platforms: ['medium', 'twitter']
					}
				]
			};
			const drafterResponse = {
				drafts: [
					{
						opportunity_signal: 'sig',
						angle: 'angle',
						platforms: [
							{ platform: 'medium', content: 'medium body', metadata: {} },
							{ platform: 'twitter', content: 'twitter body', metadata: { thread_count: 3 } }
						]
					}
				]
			};
			const h = makeHarness({ angleResponse, drafterResponse });

			await orchestrateContentDrafts(h.deps, {
				runId: 'run-5',
				reportId: 'report-5',
				reportData
			});

			const byPlatform = new Map(h.inserted.map((r) => [r.platform, r.contentType]));
			assert.equal(byPlatform.get('medium'), 'long-form');
			assert.equal(byPlatform.get('twitter'), 'social');
		});
	});

	describe('voice scoping (pass 2)', () => {
		it('only injects samples for voice formats covered by chosen platforms', async () => {
			const reportData = makeReportData();
			// Pick only "medium" and "linkedin": voice formats long-form + linkedin.
			const angleResponse = {
				angles: [
					{
						opportunity_signal: 'sig',
						angle: 'angle',
						platforms: ['medium', 'linkedin']
					}
				]
			};
			const drafterResponse = {
				drafts: [
					{
						opportunity_signal: 'sig',
						angle: 'angle',
						platforms: [
							{
								platform: 'medium',
								content: 'medium body',
								metadata: { tags: [], canonical_url: null }
							},
							{ platform: 'linkedin', content: 'linkedin body', metadata: {} }
						]
					}
				]
			};
			const h = makeHarness({ angleResponse, drafterResponse });

			await orchestrateContentDrafts(h.deps, {
				runId: 'run-6',
				reportId: 'report-6',
				reportData
			});

			const drafterCall = h.pipelineCalls.find((c) => c.pipeName === 'content-drafter.pipe');
			assert.ok(drafterCall, 'expected a drafter call');
			// long-form and linkedin samples should appear in the system prompt.
			assert.match(drafterCall.system, /LONG_FORM_SAMPLE_A/);
			assert.match(drafterCall.system, /LINKEDIN_SAMPLE_A/);
			// Twitter / discord / reddit / other samples should NOT appear.
			assert.doesNotMatch(
				drafterCall.system,
				/TWITTER_SAMPLE_A/,
				'twitter samples must not leak when no twitter angle was chosen'
			);
			assert.doesNotMatch(drafterCall.system, /DISCORD_SAMPLE_A/);
			assert.doesNotMatch(drafterCall.system, /REDDIT_SAMPLE_A/);
		});
	});

	describe('voice profile is in both passes', () => {
		it('places the voice profile (tone, sentence patterns, never-write) in pass 1 and pass 2 system prompts', async () => {
			const reportData = makeReportData();
			const angleResponse = {
				angles: [
					{
						opportunity_signal: 'sig',
						angle: 'angle',
						platforms: ['medium']
					}
				]
			};
			const drafterResponse = {
				drafts: [
					{
						opportunity_signal: 'sig',
						angle: 'angle',
						platforms: [{ platform: 'medium', content: 'medium body', metadata: {} }]
					}
				]
			};
			const h = makeHarness({ angleResponse, drafterResponse });

			await orchestrateContentDrafts(h.deps, {
				runId: 'run-7',
				reportId: 'report-7',
				reportData
			});

			const angleCall = h.pipelineCalls.find((c) => c.pipeName === 'angle-picker.pipe');
			const drafterCall = h.pipelineCalls.find((c) => c.pipeName === 'content-drafter.pipe');
			assert.ok(angleCall, 'expected an angle-picker call');
			assert.ok(drafterCall, 'expected a content-drafter call');

			// Tone, sentence patterns, never-write rules from the voice profile.
			for (const call of [angleCall, drafterCall]) {
				assert.match(call.system, /Direct, technical, no marketing language\./);
				assert.match(call.system, /Short sentences\. Active voice\./);
				assert.match(call.system, /Never write "leverage", "synergy", or "delve"\./);
			}
		});
	});

	describe('parsing tolerance', () => {
		it('drops drafter platform variants without content', async () => {
			const reportData = makeReportData();
			const angleResponse = {
				angles: [
					{
						opportunity_signal: 'sig',
						angle: 'angle',
						platforms: ['medium', 'linkedin']
					}
				]
			};
			const drafterResponse = {
				drafts: [
					{
						opportunity_signal: 'sig',
						angle: 'angle',
						platforms: [
							{ platform: 'medium', content: 'medium body', metadata: {} },
							{ platform: 'linkedin', content: '', metadata: {} } // empty: dropped
						]
					}
				]
			};
			const h = makeHarness({ angleResponse, drafterResponse });

			const result = await orchestrateContentDrafts(h.deps, {
				runId: 'run-8',
				reportId: 'report-8',
				reportData
			});

			assert.equal(result.draftCount, 1);
			assert.equal(h.inserted.length, 1);
			assert.equal(h.inserted[0].platform, 'medium');
		});

		it('drops angles missing required fields', async () => {
			const reportData = makeReportData();
			const angleResponse = {
				angles: [
					// good
					{ opportunity_signal: 'sig', angle: 'angle', platforms: ['medium'] },
					// missing platforms array: dropped
					{ opportunity_signal: 'sig2', angle: 'angle2' },
					// platforms array empty: dropped
					{ opportunity_signal: 'sig3', angle: 'angle3', platforms: [] },
					// unknown platform name: filtered to empty: dropped
					{ opportunity_signal: 'sig4', angle: 'angle4', platforms: ['mastodon'] }
				]
			};
			const h = makeHarness({ angleResponse });

			const result = await orchestrateContentDrafts(h.deps, {
				runId: 'run-9',
				reportId: 'report-9',
				reportData
			});

			// We sent one valid angle so the orchestrator must call pass 2.
			// Drafter response defaults to empty: result.draftCount === 0 but
			// angleCount reflects the picked count.
			assert.equal(result.angleCount, 1);
			assert.equal(result.skipped, null);
		});
	});
});
