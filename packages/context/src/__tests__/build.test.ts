import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import type { OperatorContext } from '@pulsar/operator-context';
import type { VoiceContext, VoiceFormat } from '@pulsar/voice';

// Module mocks must be installed before importing the SUT.
type AnyAsync = (...args: unknown[]) => Promise<unknown>;
const mockQuery = mock.fn<AnyAsync>();
const mockLoadOperator = mock.fn<() => OperatorContext>();
const mockLoadVoice = mock.fn<(formats: VoiceFormat[]) => VoiceContext>();
const mockBuildIntelligence = mock.fn<AnyAsync>();
const mockBuildProduct = mock.fn<AnyAsync>();

mock.module('@pulsar/shared/db/postgres', {
	namedExports: { query: mockQuery }
});
mock.module('@pulsar/operator-context', {
	namedExports: {
		loadOperatorContext: mockLoadOperator
	}
});
mock.module('@pulsar/voice', {
	namedExports: {
		loadVoiceContext: mockLoadVoice
	}
});
mock.module('../intelligence/index.js', {
	namedExports: { buildIntelligence: mockBuildIntelligence }
});
mock.module('../product/index.js', {
	namedExports: { buildProduct: mockBuildProduct }
});

const { buildContext, buildReportContext } = await import('../build.js');

function makeOperator(): OperatorContext {
	return {
		operatorName: 'Jane',
		role: 'Founder',
		orgName: 'Acme',
		domain: 'market-analysis',
		allowedGitHubLogins: [],
		groundingUrls: ['https://acme.example.com'],
		positioning: 'The reliability layer.',
		audience: 'Backend engineers.',
		hardRules: [],
		glossary: {},
		trackedEntities: { entities: [], keywords: [], technologies: [] }
	};
}

function makeVoice(): VoiceContext {
	return {
		profile: { tone: 'direct', sentencePatterns: '', neverWrite: '', formats: [] },
		samples: {
			'long-form': [],
			linkedin: [],
			reddit: [],
			discord: [],
			twitter: [],
			other: []
		}
	};
}

function makeIntelligence() {
	return {
		period: { start: new Date('2026-04-01'), end: new Date('2026-05-01') },
		graphSnapshotId: 'snap-1',
		graphSnapshotSource: 'cached' as const,
		articleCount: 100,
		sourceCount: 10,
		entities: [],
		trendingKeywords: [],
		topicClusters: [],
		topDiscussions: [],
		sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 },
		topAuthors: [],
		emergingTopics: []
	};
}

function makeProduct() {
	return {
		positioning: 'The reliability layer.',
		packages: [],
		groundingUrls: ['https://acme.example.com']
	};
}

beforeEach(() => {
	mockQuery.mock.resetCalls();
	mockLoadOperator.mock.resetCalls();
	mockLoadVoice.mock.resetCalls();
	mockBuildIntelligence.mock.resetCalls();
	mockBuildProduct.mock.resetCalls();
});

afterEach(() => {
	// reset mock implementations so tests don't bleed
	mockQuery.mock.resetCalls();
	mockLoadOperator.mock.mockImplementation(() => makeOperator());
	mockLoadVoice.mock.mockImplementation(() => makeVoice());
	mockBuildIntelligence.mock.mockImplementation(async () => makeIntelligence());
	mockBuildProduct.mock.mockImplementation(async () => makeProduct());
});

describe('buildContext', () => {
	beforeEach(() => {
		mockLoadOperator.mock.mockImplementation(() => makeOperator());
		mockLoadVoice.mock.mockImplementation(() => makeVoice());
		mockBuildIntelligence.mock.mockImplementation(async () => makeIntelligence());
		mockBuildProduct.mock.mockImplementation(async () => makeProduct());
	});

	it('returns only the requested slices', async () => {
		const ctx = await buildContext({ slices: ['operator'] });
		assert.ok(ctx.operator);
		assert.equal(ctx.voice, undefined);
		assert.equal(ctx.intelligence, undefined);
		assert.equal(ctx.product, undefined);
	});

	it('resolves voice slice with the requested formats', async () => {
		const ctx = await buildContext({ slices: ['voice'], voiceFormats: ['long-form', 'linkedin'] });
		assert.ok(ctx.voice);
		assert.equal(mockLoadVoice.mock.callCount(), 1);
		assert.deepEqual(mockLoadVoice.mock.calls[0]?.arguments[0], ['long-form', 'linkedin']);
	});

	it('throws when voice slice is requested without formats', async () => {
		await assert.rejects(buildContext({ slices: ['voice'] }), /voice.*requires opts.voiceFormats/);
	});

	it('resolves intelligence slice with the provided window', async () => {
		const window = { start: new Date('2026-04-01'), end: new Date('2026-05-01') };
		const ctx = await buildContext({ slices: ['intelligence'], window });
		assert.ok(ctx.intelligence);
		assert.equal(mockBuildIntelligence.mock.callCount(), 1);
		const intelArgs = mockBuildIntelligence.mock.calls[0]?.arguments[0] as {
			window: typeof window;
		};
		assert.deepEqual(intelArgs.window, window);
	});

	it('throws when intelligence slice is requested without window or reportId', async () => {
		await assert.rejects(
			buildContext({ slices: ['intelligence'] }),
			/intelligence.*requires opts.window or opts.reportId/
		);
	});

	it('resolves product slice using the operator profile', async () => {
		const ctx = await buildContext({ slices: ['operator', 'product'] });
		assert.ok(ctx.product);
		assert.equal(mockBuildProduct.mock.callCount(), 1);
		const arg = mockBuildProduct.mock.calls[0]?.arguments[0] as { operator: OperatorContext };
		assert.equal(arg.operator.orgName, 'Acme');
	});

	it('product slice loads operator implicitly even when operator slice is not requested', async () => {
		const ctx = await buildContext({ slices: ['product'] });
		assert.ok(ctx.product);
		assert.equal(ctx.operator, undefined, 'operator field stays undefined when not requested');
		assert.equal(mockLoadOperator.mock.callCount(), 1, 'operator profile loaded once for product');
	});

	it('reportId shorthand pulls window + graph_snapshot_id from the report row', async () => {
		mockQuery.mock.mockImplementationOnce(async () => ({
			rows: [
				{
					period_start: new Date('2026-04-22'),
					period_end: new Date('2026-04-29'),
					graph_snapshot_id: 'snap-from-report'
				}
			]
		}));
		await buildContext({ slices: ['intelligence'], reportId: 'report-1' });
		assert.equal(mockQuery.mock.callCount(), 1);
		const sql = mockQuery.mock.calls[0]?.arguments[0] as string;
		const params = mockQuery.mock.calls[0]?.arguments[1] as unknown[];
		assert.match(sql, /period_start, period_end, graph_snapshot_id/);
		assert.deepEqual(params, ['report-1']);
		const intelArgs = mockBuildIntelligence.mock.calls[0]?.arguments[0] as {
			window: { start: Date; end: Date };
			preferredSnapshotId?: string;
		};
		assert.equal(intelArgs.preferredSnapshotId, 'snap-from-report');
		assert.equal(intelArgs.window.start.toISOString(), '2026-04-22T00:00:00.000Z');
	});

	it('throws when reportId does not match a row', async () => {
		mockQuery.mock.mockImplementationOnce(async () => ({ rows: [] }));
		await assert.rejects(
			buildContext({ slices: ['operator'], reportId: 'missing-id' }),
			/report missing-id not found/
		);
	});

	it('runs heavy slices in parallel (single Promise.all)', async () => {
		// Verify both intelligence and product callbacks fire even though one
		// would block the other if sequenced. The mocks resolve immediately so
		// this is a structural assertion: both got called at all.
		await buildContext({
			slices: ['operator', 'voice', 'intelligence', 'product'],
			window: { start: new Date('2026-04-01'), end: new Date('2026-05-01') },
			voiceFormats: ['long-form']
		});
		assert.equal(mockBuildIntelligence.mock.callCount(), 1);
		assert.equal(mockBuildProduct.mock.callCount(), 1);
		assert.equal(mockLoadVoice.mock.callCount(), 1);
		assert.equal(mockLoadOperator.mock.callCount(), 1);
	});
});

describe('buildReportContext', () => {
	beforeEach(() => {
		mockLoadOperator.mock.mockImplementation(() => makeOperator());
		mockLoadVoice.mock.mockImplementation(() => makeVoice());
		mockBuildIntelligence.mock.mockImplementation(async () => makeIntelligence());
		mockBuildProduct.mock.mockImplementation(async () => makeProduct());
	});

	it('resolves all four slices for an existing report', async () => {
		mockQuery.mock.mockImplementationOnce(async () => ({
			rows: [
				{
					period_start: new Date('2026-04-22'),
					period_end: new Date('2026-04-29'),
					graph_snapshot_id: 'snap-x'
				}
			]
		}));
		const ctx = await buildReportContext('report-2');
		assert.ok(ctx.operator);
		assert.ok(ctx.voice);
		assert.ok(ctx.intelligence);
		assert.ok(ctx.product);
	});

	it('uses default voice formats when none are provided', async () => {
		mockQuery.mock.mockImplementationOnce(async () => ({
			rows: [
				{
					period_start: new Date('2026-04-22'),
					period_end: new Date('2026-04-29'),
					graph_snapshot_id: null
				}
			]
		}));
		await buildReportContext('report-3');
		const formatsArg = mockLoadVoice.mock.calls[0]?.arguments[0] as VoiceFormat[];
		assert.ok(formatsArg.includes('long-form'));
		assert.ok(formatsArg.includes('linkedin'));
		assert.ok(formatsArg.includes('twitter'));
	});

	it('throws when any slice fails to resolve', async () => {
		mockQuery.mock.mockImplementationOnce(async () => ({
			rows: [
				{
					period_start: new Date('2026-04-22'),
					period_end: new Date('2026-04-29'),
					graph_snapshot_id: 'snap-y'
				}
			]
		}));
		mockBuildIntelligence.mock.mockImplementationOnce(async () => {
			throw new Error('snapshot exploded');
		});
		await assert.rejects(buildReportContext('report-4'), /snapshot exploded/);
	});
});
