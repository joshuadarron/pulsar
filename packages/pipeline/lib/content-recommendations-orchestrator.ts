// ---------------------------------------------------------------------------
// Content recommendations orchestrator (V2, two-pass)
//
// Pass 1 (`angle-picker.pipe` reused as the recommendation generator): one LLM
// call that reads the report's intelligence + product context and the trend
// report narrative. Emits `{ recommendations: ContentRecommendation[],
// prioritizationNote: string }`.
//
// Pass 2 (`content-drafter.pipe` reused): one LLM call per recommendation. The
// drafter receives ONE recommendation and writes drafts for the platforms
// mapped to its format. Voice samples scoped to those platforms only.
//
// Mirrors the V1 orchestrator's structure: dependency-injected so the flow can
// be tested without RocketRide or PostgreSQL. The runner supplies real wiring;
// tests inject fakes.
// ---------------------------------------------------------------------------

import {
	type ContentPlatform,
	FORMAT_TO_PLATFORMS,
	buildDrafterV2SystemPrompt,
	buildDrafterV2UserPrompt,
	buildRecommendationSystemPrompt,
	buildRecommendationUserPrompt,
	voiceFormatsForContentFormat
} from '@pulsar/app-market-analysis/prompts';
import type { OperatorContext, buildContext as buildContextFn } from '@pulsar/context';
import type { IntelligenceContext, ProductContext } from '@pulsar/context/types';
import type {
	ContentFormat,
	ContentRecommendation,
	ContentRecommendationsArtifact,
	ReportData
} from '@pulsar/shared/types';
import { ALL_CONTENT_FORMATS } from '@pulsar/shared/types';
import type { VoiceContext, VoiceFormat } from '@pulsar/voice';

export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export type LogFn = (
	runId: string,
	level: LogLevel,
	stage: string,
	message: string
) => Promise<void>;

/**
 * Payload sent to `angle-picker.pipe` (recommendation generator) and
 * `content-drafter.pipe` (drafter). Both .pipe agents read a single `prompt`
 * field at runtime; the runner concatenates `system` and `user` into the wire
 * payload.
 */
export type PipelinePayload = {
	system: string;
	user: string;
};

export type InvokePipelineFn = (
	runId: string,
	pipeName: 'angle-picker.pipe' | 'content-drafter.pipe',
	payload: PipelinePayload
) => Promise<unknown>;

export type Phase3DraftRow = {
	runId: string;
	reportId: string;
	platform: ContentPlatform;
	contentType: 'long-form' | 'social';
	body: string;
	angle: string;
	opportunitySignal: string;
	metadata: Record<string, unknown>;
	title: string;
	format: ContentFormat;
	target: string;
	whyNow: string;
};

export type InsertContentDraftFn = (row: Phase3DraftRow) => Promise<void>;

export type LoadOperatorContextFn = () => OperatorContext;
export type LoadVoiceContextFn = (formats: VoiceFormat[]) => VoiceContext;
export type BuildContextFn = typeof buildContextFn;

export type OrchestrateContentRecommendationsDeps = {
	loadOperator: LoadOperatorContextFn;
	loadVoice: LoadVoiceContextFn;
	buildContext: BuildContextFn;
	invokePipeline: InvokePipelineFn;
	insertDraft: InsertContentDraftFn;
	log: LogFn;
};

export type OrchestrateContentRecommendationsArgs = {
	runId: string;
	reportId: string;
	reportData: ReportData;
};

export type OrchestrateContentRecommendationsResult = {
	recommendationCount: number;
	draftCount: number;
	skipped: 'no-recommendations' | 'no-drafts' | null;
	prioritizationNote?: string;
};

const ANGLE_PICKER_PIPE = 'angle-picker.pipe';
const CONTENT_DRAFTER_PIPE = 'content-drafter.pipe';
const STAGE = 'content-drafts';

const SOCIAL_PLATFORMS: ReadonlySet<ContentPlatform> = new Set(['linkedin', 'twitter', 'discord']);

function platformContentType(platform: ContentPlatform): 'long-form' | 'social' {
	return SOCIAL_PLATFORMS.has(platform) ? 'social' : 'long-form';
}

function isContentFormat(value: unknown): value is ContentFormat {
	return typeof value === 'string' && (ALL_CONTENT_FORMATS as readonly string[]).includes(value);
}

function trimString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

// ---------------------------------------------------------------------------
// Pass 1 parsing: recommendations artifact
// ---------------------------------------------------------------------------

type RawRecommendation = {
	title?: unknown;
	format?: unknown;
	signal?: unknown;
	angle?: unknown;
	target?: unknown;
	whyNow?: unknown;
	priorityHint?: unknown;
};

type RawRecommendationsArtifact = {
	recommendations?: unknown;
	prioritizationNote?: unknown;
};

function parseRecommendation(raw: RawRecommendation): ContentRecommendation | null {
	const title = trimString(raw.title);
	const format = raw.format;
	const signal = trimString(raw.signal);
	const angle = trimString(raw.angle);
	const target = trimString(raw.target);
	const whyNow = trimString(raw.whyNow);

	if (!title || !signal || !angle || !target || !whyNow) return null;
	if (!isContentFormat(format)) return null;

	const rec: ContentRecommendation = { title, format, signal, angle, target, whyNow };
	if (
		raw.priorityHint === 'now' ||
		raw.priorityHint === 'this-week' ||
		raw.priorityHint === 'durable'
	) {
		rec.priorityHint = raw.priorityHint;
	}
	return rec;
}

function parseRecommendationsArtifact(raw: unknown): ContentRecommendationsArtifact | null {
	if (!raw || typeof raw !== 'object') return null;
	const data = raw as RawRecommendationsArtifact;
	if (!Array.isArray(data.recommendations)) return null;

	const recommendations: ContentRecommendation[] = [];
	for (const entry of data.recommendations) {
		if (!entry || typeof entry !== 'object') continue;
		const parsed = parseRecommendation(entry as RawRecommendation);
		if (parsed) recommendations.push(parsed);
	}

	const prioritizationNote =
		typeof data.prioritizationNote === 'string' ? data.prioritizationNote.trim() : '';

	return { recommendations, prioritizationNote };
}

// ---------------------------------------------------------------------------
// Pass 2 parsing: platform variants for one recommendation
//
// Canonical drafter response is `{ platforms: [...] }` with no outer wrapper.
// Tolerate two known drift shapes:
//   - `{ drafts: [{ platforms: [...] }] }`   (drafter ignored "no outer wrapper")
//   - `[{ platform, content, metadata }]`    (drafter returned a flat array)
// ---------------------------------------------------------------------------

type RawPlatformVariant = {
	platform?: unknown;
	content?: unknown;
	metadata?: unknown;
};

type ParsedPlatformVariant = {
	platform: string;
	content: string;
	metadata: Record<string, unknown>;
};

function parsePlatformArray(value: unknown): ParsedPlatformVariant[] {
	if (!Array.isArray(value)) return [];
	const out: ParsedPlatformVariant[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== 'object') continue;
		const variant = entry as RawPlatformVariant;
		const platform = typeof variant.platform === 'string' ? variant.platform.trim() : '';
		const content = typeof variant.content === 'string' ? variant.content : '';
		if (!platform || content.trim().length === 0) continue;
		const metadata =
			variant.metadata && typeof variant.metadata === 'object' && !Array.isArray(variant.metadata)
				? (variant.metadata as Record<string, unknown>)
				: {};
		out.push({ platform, content, metadata });
	}
	return out;
}

function parseDrafterPlatforms(raw: unknown): ParsedPlatformVariant[] {
	if (!raw) return [];

	// Shape 1: flat array of platform variants.
	if (Array.isArray(raw)) {
		return parsePlatformArray(raw);
	}
	if (typeof raw !== 'object') return [];

	const obj = raw as { platforms?: unknown; drafts?: unknown };

	// Shape 2 (canonical): { platforms: [...] }
	if (Array.isArray(obj.platforms)) {
		return parsePlatformArray(obj.platforms);
	}

	// Shape 3 (tolerated drift): { drafts: [{ platforms: [...] }, ...] }
	if (Array.isArray(obj.drafts)) {
		const merged: ParsedPlatformVariant[] = [];
		for (const draft of obj.drafts) {
			if (!draft || typeof draft !== 'object') continue;
			const inner = (draft as { platforms?: unknown }).platforms;
			if (Array.isArray(inner)) {
				merged.push(...parsePlatformArray(inner));
			}
		}
		return merged;
	}

	return [];
}

// ---------------------------------------------------------------------------
// Voice scoping: build the samples object passed into the drafter system prompt
// ---------------------------------------------------------------------------

function scopedSamples(
	voice: VoiceContext,
	formats: VoiceFormat[]
): Partial<Record<VoiceFormat, string[]>> {
	const out: Partial<Record<VoiceFormat, string[]>> = {};
	for (const format of formats) {
		out[format] = voice.samples[format] ?? [];
	}
	return out;
}

function platformsForRecommendation(rec: ContentRecommendation): ReadonlySet<ContentPlatform> {
	return new Set(FORMAT_TO_PLATFORMS[rec.format]);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Two-pass content recommendations + drafts orchestration (V2).
 *
 * Returns counts and a `skipped` reason when the run is short-circuited
 * (intelligence/product context unavailable, recommendation generator emits
 * nothing usable, or drafter emits nothing usable across all recommendations).
 *
 * @param deps Injected dependencies. The runner builds production wiring;
 *   tests inject fakes.
 * @param args Run + report identifiers and the completed report data.
 */
export async function orchestrateContentRecommendations(
	deps: OrchestrateContentRecommendationsDeps,
	args: OrchestrateContentRecommendationsArgs
): Promise<OrchestrateContentRecommendationsResult> {
	const { runId, reportId, reportData } = args;
	const { loadOperator, loadVoice, buildContext, invokePipeline, insertDraft, log } = deps;

	const operatorContext = loadOperator();
	const voiceProfileOnly = loadVoice([]);

	// --- Build intelligence + product context ---
	let intelligence: IntelligenceContext | undefined;
	let product: ProductContext | undefined;
	try {
		const ctx = await buildContext({
			slices: ['intelligence', 'product'],
			reportId
		});
		intelligence = ctx.intelligence;
		product = ctx.product;
	} catch (err) {
		await log(
			runId,
			'warn',
			STAGE,
			`V2 context unavailable (buildContext threw): ${err}. Skipping recommendations.`
		);
		return { recommendationCount: 0, draftCount: 0, skipped: 'no-recommendations' };
	}

	if (!intelligence || !product) {
		await log(
			runId,
			'warn',
			STAGE,
			'V2 context unavailable (intelligence or product slice missing). Skipping recommendations.'
		);
		return { recommendationCount: 0, draftCount: 0, skipped: 'no-recommendations' };
	}

	// --- Pass 1: recommendation generator ---
	await log(runId, 'info', STAGE, 'Pass 1: generating content recommendations...');

	const recSystem = buildRecommendationSystemPrompt(operatorContext, voiceProfileOnly);
	const recUser = buildRecommendationUserPrompt({
		intelligence,
		product,
		reportSections: {
			executiveSummary: reportData.sections.executiveSummary.text,
			marketSnapshot: reportData.sections.marketSnapshot.text,
			developerSignals: reportData.sections.developerSignals.text,
			signalInterpretation: reportData.sections.signalInterpretation.text
		}
	});

	const recResponse = await invokePipeline(runId, ANGLE_PICKER_PIPE, {
		system: recSystem,
		user: recUser
	});
	const artifact = parseRecommendationsArtifact(recResponse);

	if (!artifact) {
		await log(
			runId,
			'warn',
			STAGE,
			'Recommendation generator returned a malformed response. Skipping drafts.'
		);
		return { recommendationCount: 0, draftCount: 0, skipped: 'no-recommendations' };
	}

	if (artifact.recommendations.length === 0) {
		await log(
			runId,
			'info',
			STAGE,
			'Recommendation generator returned 0 recommendations. Skipping drafts.'
		);
		return {
			recommendationCount: 0,
			draftCount: 0,
			skipped: 'no-recommendations',
			prioritizationNote: artifact.prioritizationNote
		};
	}

	await log(
		runId,
		'info',
		STAGE,
		`Pass 1 complete: ${artifact.recommendations.length} recommendation(s) selected.`
	);

	// --- Pass 2: per-recommendation drafts (sequential) ---
	//
	// One drafter call per recommendation keeps each response small enough to
	// land cleanly under max_tokens, isolates failures so one bad recommendation
	// does not zero out the others, and keeps the run console log readable.
	await log(
		runId,
		'info',
		STAGE,
		`Pass 2: writing drafts for ${artifact.recommendations.length} recommendation(s)...`
	);

	let draftCount = 0;
	for (let i = 0; i < artifact.recommendations.length; i += 1) {
		const rec = artifact.recommendations[i];
		const label = `${i + 1}/${artifact.recommendations.length}`;
		const titlePreview = rec.title.slice(0, 80);
		await log(runId, 'info', STAGE, `Pass 2 [${label}]: ${titlePreview}`);

		const voiceFormats = voiceFormatsForContentFormat(rec.format);
		const voiceWithSamples = loadVoice(voiceFormats);
		const samples = scopedSamples(voiceWithSamples, voiceFormats);

		const drafterSystem = buildDrafterV2SystemPrompt(operatorContext, voiceWithSamples, samples);
		const drafterUser = buildDrafterV2UserPrompt({
			recommendation: rec,
			reportContext: {
				executiveSummary: reportData.sections.executiveSummary.text,
				marketSnapshot: reportData.sections.marketSnapshot.text
			}
		});

		const drafterResponse = await invokePipeline(runId, CONTENT_DRAFTER_PIPE, {
			system: drafterSystem,
			user: drafterUser
		});
		const variants = parseDrafterPlatforms(drafterResponse);

		if (variants.length === 0) {
			await log(runId, 'warn', STAGE, `Pass 2 [${label}] returned 0 drafts, skipping.`);
			continue;
		}

		const candidatePlatforms = platformsForRecommendation(rec);
		for (const variant of variants) {
			if (!candidatePlatforms.has(variant.platform as ContentPlatform)) {
				await log(
					runId,
					'warn',
					STAGE,
					`Pass 2 [${label}]: drafter returned unexpected platform '${variant.platform}', skipping.`
				);
				continue;
			}
			const platform = variant.platform as ContentPlatform;
			await insertDraft({
				runId,
				reportId,
				platform,
				contentType: platformContentType(platform),
				body: variant.content,
				angle: rec.angle,
				opportunitySignal: rec.signal,
				metadata: variant.metadata,
				title: rec.title,
				format: rec.format,
				target: rec.target,
				whyNow: rec.whyNow
			});
			draftCount += 1;
		}
	}

	if (draftCount === 0) {
		await log(
			runId,
			'warn',
			STAGE,
			`Pass 2 yielded 0 platform drafts across ${artifact.recommendations.length} recommendation(s).`
		);
		return {
			recommendationCount: artifact.recommendations.length,
			draftCount: 0,
			skipped: 'no-drafts',
			prioritizationNote: artifact.prioritizationNote
		};
	}

	await log(
		runId,
		'success',
		STAGE,
		`Generated ${artifact.recommendations.length} recommendation(s) across ${draftCount} platform draft(s).`
	);

	return {
		recommendationCount: artifact.recommendations.length,
		draftCount,
		skipped: null,
		prioritizationNote: artifact.prioritizationNote
	};
}
