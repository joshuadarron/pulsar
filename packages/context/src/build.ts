import { type OperatorContext, loadOperatorContext } from '@pulsar/operator-context';
import { query } from '@pulsar/shared/db/postgres';
import { type VoiceContext, type VoiceFormat, loadVoiceContext } from '@pulsar/voice';

import { buildIntelligence } from './intelligence/index.js';
import { buildProduct } from './product/index.js';
import type {
	AppContext,
	BuildContextOptions,
	IntelligenceContext,
	ProductContext
} from './types.js';

/**
 * Build the context any app needs to feed to an LLM call.
 *
 * Slices are independent: pass `slices: ['operator']` for a thin context, or all
 * four for the full one. Errors fetching one slice do not abort the others; each
 * slice's failure is logged and that field is left undefined on the result.
 *
 * For 'intelligence' you must pass either `window` or `reportId` (the latter is
 * a shorthand that resolves the window from the report row, with the snapshot
 * also resolved if `report.graph_snapshot_id` is set).
 *
 * For 'voice' you must pass `voiceFormats` so the loader knows which format
 * sample folders to read.
 */
export async function buildContext(opts: BuildContextOptions): Promise<AppContext> {
	const wantOperator = opts.slices.includes('operator');
	const wantVoice = opts.slices.includes('voice');
	const wantIntelligence = opts.slices.includes('intelligence');
	const wantProduct = opts.slices.includes('product');

	// Operator and product both need the operator profile. Resolve once.
	let operator: OperatorContext | undefined;
	if (wantOperator || wantProduct) {
		operator = loadOperatorContext();
	}

	// Resolve report-row shortcuts. Done early so window + snapshot id are
	// available for the intelligence slice.
	let window = opts.window;
	let preferredSnapshotId = opts.graphSnapshotId;
	if (opts.reportId) {
		const row = await query<{
			period_start: Date;
			period_end: Date;
			graph_snapshot_id: string | null;
		}>('SELECT period_start, period_end, graph_snapshot_id FROM reports WHERE id = $1', [
			opts.reportId
		]);
		const report = row.rows[0];
		if (!report) {
			throw new Error(`buildContext: report ${opts.reportId} not found`);
		}
		window = window ?? {
			start:
				report.period_start instanceof Date ? report.period_start : new Date(report.period_start),
			end: report.period_end instanceof Date ? report.period_end : new Date(report.period_end)
		};
		preferredSnapshotId = preferredSnapshotId ?? report.graph_snapshot_id ?? undefined;
	}

	// Run the heavy slices in parallel where possible.
	const [voice, intelligence, product] = await Promise.all([
		wantVoice ? resolveVoice(opts.voiceFormats) : Promise.resolve(undefined),
		wantIntelligence
			? resolveIntelligence(window, preferredSnapshotId, opts)
			: Promise.resolve(undefined),
		wantProduct && operator ? resolveProduct(operator) : Promise.resolve(undefined)
	]);

	const ctx: AppContext = {};
	if (wantOperator) ctx.operator = operator;
	if (voice) ctx.voice = voice;
	if (intelligence) ctx.intelligence = intelligence;
	if (product) ctx.product = product;
	return ctx;
}

/**
 * Shorthand for the common case of reconstructing the full context for an
 * existing report. Reads `period_start`, `period_end`, and `graph_snapshot_id`
 * from the report row, then resolves all four slices.
 */
export async function buildReportContext(
	reportId: string,
	opts: { voiceFormats?: readonly VoiceFormat[]; forceRecomputeSnapshot?: boolean } = {}
): Promise<Required<Pick<AppContext, 'operator' | 'voice' | 'intelligence' | 'product'>>> {
	const voiceFormats = opts.voiceFormats ?? [
		'long-form',
		'linkedin',
		'reddit',
		'discord',
		'twitter',
		'other'
	];

	const ctx = await buildContext({
		slices: ['operator', 'voice', 'intelligence', 'product'],
		reportId,
		voiceFormats,
		forceRecomputeSnapshot: opts.forceRecomputeSnapshot
	});

	if (!ctx.operator || !ctx.voice || !ctx.intelligence || !ctx.product) {
		throw new Error(
			'buildReportContext: one or more slices failed to resolve. Inspect logs for details.'
		);
	}

	return {
		operator: ctx.operator,
		voice: ctx.voice,
		intelligence: ctx.intelligence,
		product: ctx.product
	};
}

// ---------------------------------------------------------------------------

async function resolveVoice(formats: readonly VoiceFormat[] | undefined): Promise<VoiceContext> {
	if (!formats || formats.length === 0) {
		throw new Error("buildContext: 'voice' slice requires opts.voiceFormats");
	}
	return loadVoiceContext([...formats]);
}

async function resolveIntelligence(
	window: BuildContextOptions['window'],
	preferredSnapshotId: string | undefined,
	opts: BuildContextOptions
): Promise<IntelligenceContext> {
	if (!window) {
		throw new Error("buildContext: 'intelligence' slice requires opts.window or opts.reportId");
	}
	return buildIntelligence({
		window,
		preferredSnapshotId,
		forceRecomputeSnapshot: opts.forceRecomputeSnapshot
	});
}

async function resolveProduct(operator: OperatorContext): Promise<ProductContext> {
	return buildProduct({ operator });
}
