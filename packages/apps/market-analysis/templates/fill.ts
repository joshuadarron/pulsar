// ---------------------------------------------------------------------------
// Template fill helper
//
// Renders the post-step and scoping-prompt markdown templates for a given
// content draft, substituting mustache-style `{{placeholder}}` tokens with
// values from the draft, the report, the operator context, and the voice
// context. Templates are read once at module init and cached in memory.
//
// Placeholders without a source value are left in place (literal `{{key}}`
// text) so the operator sees what they need to fill in by hand. Empty-string
// substitution is intentionally avoided.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { OperatorContext } from '@pulsar/context';
import type { ContentDraft, ReportData, SignalInterpretation } from '@pulsar/shared/types';
import type { VoiceContext, VoiceFormat } from '@pulsar/voice';

import { type ContentPlatform, voiceFormatForPlatform } from '../prompts/content-drafts.js';

export type FillContext = {
	draft: ContentDraft;
	operator: OperatorContext;
	voice: VoiceContext;
	report: ReportData;
};

const TEMPLATES_DIR = path.dirname(fileURLToPath(import.meta.url));

const POST_STEP_PLATFORMS: readonly ContentPlatform[] = [
	'hashnode',
	'medium',
	'devto',
	'hackernews',
	'linkedin',
	'twitter',
	'discord'
] as const;

function loadTemplate(relPath: string): string {
	return readFileSync(path.join(TEMPLATES_DIR, relPath), 'utf8');
}

function loadPostStepTemplates(): Record<ContentPlatform, string> {
	const out = {} as Record<ContentPlatform, string>;
	for (const platform of POST_STEP_PLATFORMS) {
		out[platform] = loadTemplate(path.join('post-steps', `${platform}.md`));
	}
	return out;
}

const POST_STEP_TEMPLATES: Record<ContentPlatform, string> = loadPostStepTemplates();
const VOICE_TRANSFER_TEMPLATE: string = loadTemplate(
	path.join('scoping-prompts', 'voice-transfer.md')
);
const TOPIC_REFINEMENT_TEMPLATE: string = loadTemplate(
	path.join('scoping-prompts', 'topic-refinement.md')
);

function isContentPlatform(value: string): value is ContentPlatform {
	return (POST_STEP_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Substitute mustache placeholders in `template` using `values`. Any
 * `{{key}}` whose `key` is missing from `values` (or whose value is null /
 * undefined / empty string) is left in place verbatim. This signals to the
 * operator that they need to fill the slot by hand.
 */
function substitute(template: string, values: Record<string, string | null | undefined>): string {
	return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) => {
		const value = values[key];
		if (value === null || value === undefined || value === '') {
			return match;
		}
		return value;
	});
}

/**
 * Extract a title for the draft. Prefers the first H1 line of the body; if
 * none exists, falls back to the first 80 trimmed characters of the body.
 */
function extractTitle(body: string): string {
	const lines = body.split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('# ')) {
			return trimmed.slice(2).trim();
		}
	}
	const flattened = body.replace(/\s+/g, ' ').trim();
	return flattened.length > 80 ? flattened.slice(0, 80).trim() : flattened;
}

function readMetadataString(metadata: Record<string, unknown> | null, key: string): string | null {
	if (!metadata) return null;
	const value = metadata[key];
	return typeof value === 'string' ? value : null;
}

function readMetadataStringArray(
	metadata: Record<string, unknown> | null,
	key: string
): string[] | null {
	if (!metadata) return null;
	const value = metadata[key];
	if (!Array.isArray(value)) return null;
	const strings = value.filter((entry): entry is string => typeof entry === 'string');
	return strings.length === value.length ? strings : null;
}

function readMetadataNumber(metadata: Record<string, unknown> | null, key: string): number | null {
	if (!metadata) return null;
	const value = metadata[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatVoiceSamples(samples: string[]): string {
	if (samples.length === 0) {
		return '(no samples on file)';
	}
	return samples.map((sample, idx) => `### Sample ${idx + 1}\n\n${sample.trim()}`).join('\n\n');
}

function pickInterpretation(
	report: ReportData,
	opportunitySignal: string | null
): SignalInterpretation | null {
	const list = report.sections?.signalInterpretation?.interpretations ?? [];
	if (list.length === 0) return null;
	if (opportunitySignal) {
		const needle = opportunitySignal.toLowerCase();
		const match = list.find((entry) => {
			const haystack = entry.signal.toLowerCase();
			return haystack.includes(needle) || needle.includes(haystack);
		});
		if (match) return match;
	}
	return list[0];
}

/**
 * Returns the post-step template for the draft's platform, with placeholders
 * substituted from the draft body and metadata.
 *
 * @throws if `ctx.draft.platform` is not one of the known content platforms.
 */
export function fillPostSteps(ctx: FillContext): string {
	const platform = ctx.draft.platform;
	if (!isContentPlatform(platform)) {
		throw new Error(`fillPostSteps: no post-step template registered for platform "${platform}"`);
	}
	const template = POST_STEP_TEMPLATES[platform];
	const metadata = ctx.draft.metadata ?? null;

	const tagsArr = readMetadataStringArray(metadata, 'tags');
	const tags = tagsArr === null ? null : tagsArr.length > 0 ? tagsArr.join(', ') : '(none)';
	const canonicalUrlValue = readMetadataString(metadata, 'canonical_url');
	const canonicalUrl =
		metadata && 'canonical_url' in metadata
			? canonicalUrlValue !== null
				? canonicalUrlValue
				: '(leave blank)'
			: null;

	const threadCountNum = readMetadataNumber(metadata, 'thread_count');
	const threadCount = platform === 'twitter' ? String(threadCountNum ?? 1) : null;

	const values: Record<string, string | null> = {
		title: extractTitle(ctx.draft.body),
		tags,
		canonical_url: canonicalUrl,
		thread_count: threadCount
		// schedule_time intentionally omitted so the literal {{schedule_time}}
		// stays in the rendered template for the operator to fill.
	};

	return substitute(template, values);
}

/**
 * Returns the voice-transfer scoping prompt for the draft, filled with the
 * voice profile and the platform-specific samples.
 */
export function fillVoiceTransferPrompt(ctx: FillContext): string {
	const platform = ctx.draft.platform;
	const voiceFormat: VoiceFormat = isContentPlatform(platform)
		? voiceFormatForPlatform(platform)
		: 'other';
	const samples = ctx.voice.samples?.[voiceFormat] ?? [];

	const values: Record<string, string | null> = {
		platform,
		voice_tone: ctx.voice.profile.tone || null,
		voice_sentence_patterns: ctx.voice.profile.sentencePatterns || null,
		voice_never_write: ctx.voice.profile.neverWrite || null,
		voice_samples: formatVoiceSamples(samples),
		draft_content: ctx.draft.body
	};

	return substitute(VOICE_TRANSFER_TEMPLATE, values);
}

/**
 * Returns the topic-refinement scoping prompt for the draft, filled with
 * report context and the matched signal interpretation.
 */
export function fillTopicRefinementPrompt(ctx: FillContext): string {
	const platform = ctx.draft.platform;
	const interpretation = pickInterpretation(ctx.report, ctx.draft.opportunitySignal);

	const fallbackSignal = ctx.draft.opportunitySignal ?? null;
	const fallbackText = '(no interpretation captured)';

	const values: Record<string, string | null> = {
		platform,
		executive_summary: ctx.report.sections?.executiveSummary?.text || null,
		market_snapshot: ctx.report.sections?.marketSnapshot?.text || null,
		opportunity_signal: ctx.draft.opportunitySignal,
		angle: ctx.draft.angle,
		interpretation_signal: interpretation ? interpretation.signal : fallbackSignal,
		interpretation_meaning: interpretation ? interpretation.meaning : fallbackText,
		interpretation_implication: interpretation ? interpretation.implication : fallbackText,
		draft_content: ctx.draft.body
	};

	return substitute(TOPIC_REFINEMENT_TEMPLATE, values);
}

/**
 * Map of post-step templates keyed by platform. Exposed so the UI agent can
 * detect which platforms have a registered template ahead of rendering.
 */
export const POST_STEP_PLATFORM_LIST: readonly ContentPlatform[] = POST_STEP_PLATFORMS;
