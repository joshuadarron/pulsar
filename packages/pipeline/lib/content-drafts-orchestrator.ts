// ---------------------------------------------------------------------------
// Content drafts orchestrator (Phase 5, two-pass)
//
// Pass 1 (`angle-picker.pipe`): light LLM call. Reads the completed report's
// signal interpretations and emits `{ angles: [{opportunity_signal, angle,
// platforms: [...]}] }`.
//
// Pass 2 (`content-drafter.pipe`): heavier LLM call with platform-specific
// voice samples. Emits `{ drafts: [{opportunity_signal, angle, platforms:
// [{platform, content, metadata}]}] }`.
//
// This module is dependency-injected so the orchestration can be tested
// without spinning up RocketRide or PostgreSQL.
// ---------------------------------------------------------------------------

import {
	ALL_CONTENT_PLATFORMS,
	type AngleChoice,
	type ContentPlatform,
	buildAnglePickerSystemPrompt,
	buildAnglePickerUserPrompt,
	buildDrafterSystemPrompt,
	buildDrafterUserPrompt,
	voiceFormatForPlatform
} from '@pulsar/app-market-analysis/prompts/content-drafts';
import type { OperatorContext } from '@pulsar/context';
import type { ReportData } from '@pulsar/shared/types';
import type { VoiceContext, VoiceFormat } from '@pulsar/voice';

export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export type LogFn = (
	runId: string,
	level: LogLevel,
	stage: string,
	message: string
) => Promise<void>;

/**
 * Payload shape sent to both `angle-picker.pipe` and `content-drafter.pipe`.
 *
 * The .pipe files expose a single `agent_crewai` component with static
 * instructions; all operator-specific content lives in `prompt` (system
 * directives concatenated with the per-call user prompt). `data` is
 * reserved for future structured input lanes; today it is unused.
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

export type ContentDraftRow = {
	runId: string;
	reportId: string;
	platform: ContentPlatform;
	contentType: 'long-form' | 'social';
	body: string;
	angle: string;
	opportunitySignal: string;
	metadata: Record<string, unknown>;
};

export type InsertContentDraftFn = (row: ContentDraftRow) => Promise<void>;

export type LoadOperatorContextFn = () => OperatorContext;
export type LoadVoiceContextFn = (formats: VoiceFormat[]) => VoiceContext;

export interface OrchestrateContentDraftsDeps {
	loadOperator: LoadOperatorContextFn;
	loadVoice: LoadVoiceContextFn;
	invokePipeline: InvokePipelineFn;
	insertDraft: InsertContentDraftFn;
	log: LogFn;
}

export interface OrchestrateContentDraftsArgs {
	runId: string;
	reportId: string;
	reportData: ReportData;
}

export interface OrchestrateContentDraftsResult {
	angleCount: number;
	draftCount: number;
	skipped: 'no-interpretations' | 'no-angles' | null;
}

const ANGLE_PICKER_PIPE = 'angle-picker.pipe';
const CONTENT_DRAFTER_PIPE = 'content-drafter.pipe';

const SOCIAL_PLATFORMS: ReadonlySet<ContentPlatform> = new Set(['linkedin', 'twitter', 'discord']);

function platformContentType(platform: ContentPlatform): 'long-form' | 'social' {
	return SOCIAL_PLATFORMS.has(platform) ? 'social' : 'long-form';
}

function isContentPlatform(value: unknown): value is ContentPlatform {
	return typeof value === 'string' && (ALL_CONTENT_PLATFORMS as readonly string[]).includes(value);
}

interface RawAnglePickerResponse {
	angles?: Array<{
		opportunity_signal?: unknown;
		angle?: unknown;
		platforms?: unknown;
	}>;
}

interface RawDrafterResponse {
	drafts?: Array<{
		opportunity_signal?: unknown;
		angle?: unknown;
		platforms?: Array<{
			platform?: unknown;
			content?: unknown;
			metadata?: unknown;
		}>;
	}>;
}

function parseAngles(raw: unknown): AngleChoice[] {
	if (!raw || typeof raw !== 'object') return [];
	const data = raw as RawAnglePickerResponse;
	if (!Array.isArray(data.angles)) return [];

	const out: AngleChoice[] = [];
	for (const entry of data.angles) {
		if (!entry || typeof entry !== 'object') continue;
		const opportunity_signal =
			typeof entry.opportunity_signal === 'string' ? entry.opportunity_signal.trim() : '';
		const angle = typeof entry.angle === 'string' ? entry.angle.trim() : '';
		if (!opportunity_signal || !angle) continue;

		const platforms = Array.isArray(entry.platforms)
			? entry.platforms.filter(isContentPlatform)
			: [];
		if (platforms.length === 0) continue;

		out.push({ opportunity_signal, angle, platforms });
	}
	return out;
}

interface ParsedDraftPlatformVariant {
	platform: ContentPlatform;
	content: string;
	metadata: Record<string, unknown>;
}

interface ParsedDraft {
	opportunity_signal: string;
	angle: string;
	platforms: ParsedDraftPlatformVariant[];
}

function parseDrafts(raw: unknown): ParsedDraft[] {
	if (!raw || typeof raw !== 'object') return [];
	const data = raw as RawDrafterResponse;
	if (!Array.isArray(data.drafts)) return [];

	const out: ParsedDraft[] = [];
	for (const entry of data.drafts) {
		if (!entry || typeof entry !== 'object') continue;
		const opportunity_signal =
			typeof entry.opportunity_signal === 'string' ? entry.opportunity_signal.trim() : '';
		const angle = typeof entry.angle === 'string' ? entry.angle.trim() : '';
		if (!opportunity_signal || !angle) continue;
		if (!Array.isArray(entry.platforms)) continue;

		const platforms: ParsedDraftPlatformVariant[] = [];
		for (const variant of entry.platforms) {
			if (!variant || typeof variant !== 'object') continue;
			if (!isContentPlatform(variant.platform)) continue;
			if (typeof variant.content !== 'string' || variant.content.trim().length === 0) continue;
			const metadata =
				variant.metadata && typeof variant.metadata === 'object' && !Array.isArray(variant.metadata)
					? (variant.metadata as Record<string, unknown>)
					: {};
			platforms.push({
				platform: variant.platform,
				content: variant.content,
				metadata
			});
		}
		if (platforms.length === 0) continue;
		out.push({ opportunity_signal, angle, platforms });
	}
	return out;
}

/**
 * Two-pass content drafts orchestration.
 *
 * Returns counts and a `skipped` reason when the pass is short-circuited
 * (empty interpretations or zero angles emitted).
 *
 * @param deps Injected dependencies. The runner builds production wiring;
 *   tests inject fakes.
 * @param args Run + report identifiers and the completed report data.
 */
export async function orchestrateContentDrafts(
	deps: OrchestrateContentDraftsDeps,
	args: OrchestrateContentDraftsArgs
): Promise<OrchestrateContentDraftsResult> {
	const { runId, reportId, reportData } = args;
	const { loadOperator, loadVoice, invokePipeline, insertDraft, log } = deps;

	const interpretations = reportData.sections.signalInterpretation.interpretations ?? [];
	const narrative = reportData.sections.signalInterpretation.narrative ?? [];
	if (interpretations.length === 0 && narrative.length === 0) {
		await log(
			runId,
			'info',
			'content-drafts',
			'No signal interpretation content to draft from. Skipping.'
		);
		return { angleCount: 0, draftCount: 0, skipped: 'no-interpretations' };
	}

	const operatorContext = loadOperator();
	// Load all voice formats up front so pass 1 can ground in the profile and
	// pass 2 has samples ready for whichever platforms the picker selects.
	const allFormats: VoiceFormat[] = [
		'long-form',
		'linkedin',
		'reddit',
		'discord',
		'twitter',
		'other'
	];
	const voice = loadVoice(allFormats);

	// --- Pass 1: angle picker ---
	await log(runId, 'info', 'content-drafts', 'Pass 1: selecting angles...');

	const angleSystem = buildAnglePickerSystemPrompt(operatorContext, voice);
	const angleUser = buildAnglePickerUserPrompt({
		signalInterpretation: reportData.sections.signalInterpretation,
		executiveSummary: reportData.sections.executiveSummary.text,
		marketSnapshot: reportData.sections.marketSnapshot.text,
		developerSignals: reportData.sections.developerSignals.text
	});

	const angleResponse = await invokePipeline(runId, ANGLE_PICKER_PIPE, {
		system: angleSystem,
		user: angleUser
	});
	const angles = parseAngles(angleResponse);

	if (angles.length === 0) {
		await log(
			runId,
			'info',
			'content-drafts',
			'Angle picker returned 0 angles. Skipping draft generation.'
		);
		return { angleCount: 0, draftCount: 0, skipped: 'no-angles' };
	}

	await log(
		runId,
		'info',
		'content-drafts',
		`Pass 1 complete: ${angles.length} angle(s) selected.`
	);

	// --- Pass 2: per-platform drafts (fan out: one LLM call per angle x platform) ---
	//
	// Why fan out at the platform level: even with one call per angle, the
	// drafter has to produce 3-4 platform bodies (e.g., hashnode + medium +
	// linkedin + twitter) in a single response. Each long-form body is 1500
	// to 2500 words, which together blow past the LLM's max output cap and
	// truncate mid-string, dropping every draft for that angle.
	//
	// One call per (angle, platform) keeps each response to a single body.
	// Each platform succeeds or fails independently. Tradeoff: ~3-4x more
	// LLM calls per pipeline run than a per-angle fan-out, plus the wall
	// time. In practice this is acceptable for daily report runs.
	//
	// Sequential (not parallel): readable run log, no rate-limit pile-up.
	const totalCalls = angles.reduce((acc, a) => acc + a.platforms.length, 0);
	await log(
		runId,
		'info',
		'content-drafts',
		`Pass 2: writing ${totalCalls} draft(s) across ${angles.length} angle(s)...`
	);

	let totalVariants = 0;
	let anglesWithAtLeastOneDraft = 0;
	let callIndex = 0;
	for (let i = 0; i < angles.length; i += 1) {
		const angle = angles[i];
		const angleLabel = `angle ${i + 1}/${angles.length}`;
		const angleSummary = angle.angle.slice(0, 60);
		let angleDraftCount = 0;

		for (let j = 0; j < angle.platforms.length; j += 1) {
			const platform = angle.platforms[j];
			callIndex += 1;
			const callLabel = `${callIndex}/${totalCalls}`;
			const voiceFormat = voiceFormatForPlatform(platform);
			const samplesForPlatform: Partial<Record<VoiceFormat, string[]>> = {
				[voiceFormat]: voice.samples[voiceFormat] ?? []
			};

			const drafterSystem = buildDrafterSystemPrompt(operatorContext, voice, samplesForPlatform);
			const drafterUser = buildDrafterUserPrompt({
				angles: [{ ...angle, platforms: [platform] }],
				reportContext: {
					executiveSummary: reportData.sections.executiveSummary.text,
					marketSnapshot: reportData.sections.marketSnapshot.text
				}
			});

			await log(
				runId,
				'info',
				'content-drafts',
				`Pass 2 [${callLabel}]: ${platform} for ${angleLabel} (${angleSummary})`
			);

			const drafterResponse = await invokePipeline(runId, CONTENT_DRAFTER_PIPE, {
				system: drafterSystem,
				user: drafterUser
			});
			const drafterDrafts = parseDrafts(drafterResponse);
			const variant = drafterDrafts[0]?.platforms.find((v) => v.platform === platform);
			if (!variant) {
				await log(
					runId,
					'warn',
					'content-drafts',
					`Pass 2 [${callLabel}]: drafter returned no draft for ${platform}, skipping.`
				);
				continue;
			}

			await insertDraft({
				runId,
				reportId,
				platform: variant.platform,
				contentType: platformContentType(variant.platform),
				body: variant.content,
				angle: angle.angle,
				opportunitySignal: angle.opportunity_signal,
				metadata: variant.metadata
			});
			totalVariants += 1;
			angleDraftCount += 1;
		}

		if (angleDraftCount > 0) anglesWithAtLeastOneDraft += 1;
	}

	await log(
		runId,
		'success',
		'content-drafts',
		`Generated ${anglesWithAtLeastOneDraft} angle(s) across ${totalVariants} platform draft(s).`
	);

	return {
		// angleCount reports angles selected by pass 1, regardless of how many
		// produced drafts. Use draftCount to read the number of platform variants
		// actually persisted.
		angleCount: angles.length,
		draftCount: totalVariants,
		skipped: null
	};
}
