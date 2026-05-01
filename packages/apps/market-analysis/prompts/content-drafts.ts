// ---------------------------------------------------------------------------
// Content-drafts agent prompts (two-pass)
//
// Pass 1 (`buildAnglePickerSystemPrompt` + `buildAnglePickerUserPrompt`):
//   The angle picker selects 1 to N high-signal opportunities from the
//   completed trend report's `signalInterpretation` and decides which of
//   the available content platforms each angle should target. Lightweight
//   prompt: voice profile only, no per-format samples.
//
// Pass 2 (`buildDrafterSystemPrompt` + `buildDrafterUserPrompt`):
//   The drafter expands each angle into the full content for the platforms
//   the picker chose. The system prompt receives format specs and voice
//   samples ONLY for the platforms the angles cover, keeping the prompt
//   tight per call.
//
// Both passes interpolate operator identity, hard rules, and voice rules
// from `@pulsar/context` and `@pulsar/voice`. No operator-specific values
// are hardcoded here.
// ---------------------------------------------------------------------------

import type { OperatorContext } from '@pulsar/context';
import type { VoiceContext, VoiceFormat } from '@pulsar/voice';

export type ContentPlatform =
	| 'hashnode'
	| 'medium'
	| 'devto'
	| 'hackernews'
	| 'linkedin'
	| 'twitter'
	| 'discord';

export const ALL_CONTENT_PLATFORMS: readonly ContentPlatform[] = [
	'hashnode',
	'medium',
	'devto',
	'hackernews',
	'linkedin',
	'twitter',
	'discord'
] as const;

export type AngleChoice = {
	opportunity_signal: string;
	angle: string;
	platforms: ContentPlatform[];
};

const STATIC_HARD_RULES: string[] = [
	'No em-dashes anywhere. Use commas, colons, periods, or parentheses instead.',
	'Lead with the technical insight, not the product pitch.',
	'One number per claim. Do not chain three statistics in a sentence.',
	'Cut hedging adjectives like "significantly", "substantially", "notably".',
	'Every claim must trace to either the report context or a research citation. No floating assertions.'
];

/**
 * Per-platform format specifications. Operator-agnostic: describe markdown,
 * length, frontmatter, and structural rules only. Operator identity, product
 * positioning, and CTAs come from `OperatorContext` at runtime.
 */
export const PLATFORM_FORMAT_SPECS: Record<ContentPlatform, string> = {
	hashnode: [
		'PLATFORM hashnode: Full Hashnode blog post in markdown, 1500 to 2500 words.',
		'Title as H1. Section headers as H2. Use fenced code blocks for examples.',
		'Reference specific data points and stats from the report context.',
		'End with a conclusion that grounds the insight back in the operator domain.',
		'Metadata: tags (3 to 5 relevant tags), canonical_url (nullable string).'
	].join(' '),
	medium: [
		'PLATFORM medium: Medium-optimized article, 1500 to 2500 words.',
		'Use markdown but avoid code fence language identifiers that Medium does not render well.',
		'Use bold and italic for emphasis. Structure with clear section breaks.',
		'Reference specific data points and stats from the report context.',
		'Match the operator voice profile and samples provided.',
		'Metadata: tags (3 to 5 relevant tags), canonical_url (nullable string).'
	].join(' '),
	devto: [
		'PLATFORM devto: DEV.to article. Start with YAML front matter inside a fenced code block:',
		'title, published (false), tags (up to 4 relevant tags), and optionally canonical_url.',
		'Follow with the article body in DEV.to-flavored markdown, 1500 to 2500 words.',
		'Include fenced code blocks for examples. Reference specific data points and stats.',
		'Metadata: tags (3 to 5 relevant tags), canonical_url (nullable string).'
	].join(' '),
	hackernews: [
		'PLATFORM hackernews: Hacker News submission.',
		'First line is the title, under 80 characters. Use "Show HN: ..." or "Ask HN: ..." only when it actually fits the angle.',
		'Blank line. Then 2 to 3 sentences leading with the technical insight, not the product pitch.',
		'Reference a specific trend or data point that makes this timely. Keep it factual and understated.',
		'Metadata: empty object {}.'
	].join(' '),
	linkedin: [
		'PLATFORM linkedin: LinkedIn long-form post, 800 to 1200 words.',
		'No markdown (LinkedIn strips most of it). First-person narrative.',
		'Open with a hook that states a contrarian or surprising observation.',
		'Build the argument with specific data points and examples.',
		'End with a question to drive comments. Reference the operator product naturally within the narrative, not as a sales pitch.',
		'Metadata: empty object {}.'
	].join(' '),
	twitter: [
		'PLATFORM twitter: Numbered thread of 5 to 8 tweets.',
		'Tweet 1 is the hook, no numbering prefix. Subsequent tweets prefixed "2/", "3/", etc.',
		'Each tweet under 280 characters. The last tweet may reference the operator product if natural.',
		'No hashtags. Lead with a technical insight or surprising data point, not a product announcement.',
		'Each tweet should stand alone but build on the thread narrative.',
		'Metadata: thread_count (integer count of tweets in the thread).'
	].join(' '),
	discord: [
		'PLATFORM discord: Short Discord community announcement, 2 to 3 sentences.',
		'Community-ping tone, casual but technical. Reference a specific trend or data point that is timely.',
		'End with a discussion prompt question that invites community members to share their experience or opinion.',
		'Metadata: empty object {}.'
	].join(' ')
};

function formatHardRules(ctx: OperatorContext): string {
	const merged = [...ctx.hardRules, ...STATIC_HARD_RULES];
	return merged.map((rule, idx) => `${idx + 1}. ${rule}`).join('\n');
}

function formatVoiceProfile(voice: VoiceContext): string {
	const lines: string[] = [];
	if (voice.profile.tone) {
		lines.push('### Tone', voice.profile.tone, '');
	}
	if (voice.profile.sentencePatterns) {
		lines.push('### Sentence patterns', voice.profile.sentencePatterns, '');
	}
	if (voice.profile.neverWrite) {
		lines.push('### What never to write', voice.profile.neverWrite, '');
	}
	if (lines.length === 0) {
		return 'No operator voice profile configured.';
	}
	return lines.join('\n').trim();
}

function formatVoiceSamples(samples: Partial<Record<VoiceFormat, string[]>>): string {
	const sections: string[] = [];
	const orderedFormats: VoiceFormat[] = [
		'long-form',
		'linkedin',
		'reddit',
		'discord',
		'twitter',
		'other'
	];
	for (const format of orderedFormats) {
		const list = samples[format];
		if (!list || list.length === 0) continue;
		sections.push(`### ${format} samples`);
		for (let i = 0; i < list.length; i += 1) {
			sections.push(`Sample ${i + 1}:`);
			sections.push(list[i].trim());
			sections.push('');
		}
	}
	if (sections.length === 0) {
		return 'No voice samples loaded for the selected platforms.';
	}
	return sections.join('\n').trim();
}

/**
 * Build the angle-picker system prompt (pass 1).
 *
 * The picker reads the completed report and chooses 1 to N high-signal
 * opportunities, naming the angle and selecting platforms. No per-format
 * samples are loaded at this stage; only the operator voice profile and
 * platform list.
 *
 * @param ctx Operator context loaded from `loadOperatorContext()`.
 * @param voice Voice context loaded from `loadVoiceContext()`.
 * @returns The full system prompt for the angle-picker pass.
 */
export function buildAnglePickerSystemPrompt(ctx: OperatorContext, voice: VoiceContext): string {
	const orgName = ctx.orgName || 'the operator';
	const operatorRef = ctx.operatorName ? `${ctx.operatorName} at ${orgName}` : orgName;
	const platformList = ALL_CONTENT_PLATFORMS.join(', ');

	return `You are the content angle picker for Pulsar, an intelligence system serving ${operatorRef}.

## Who you serve

${ctx.positioning || `${orgName} positioning is supplied via operator context.`}

Your audience is: ${ctx.audience || 'configured via operator context.'}

## What you do

You read the completed market trend report (executive summary, market snapshot, developer signals, and signal interpretations). For each high-signal opportunity in the report you decide:
1. Which signal interpretation it springs from (echo the operator-relevant signal verbatim or paraphrase tightly).
2. The angle: one crisp, technical sentence framing what the piece will argue.
3. Which platforms that angle lands on.

You do NOT write the drafts. The drafter pass takes your angles and expands each one into the full content for the chosen platforms.

## Available platforms

${platformList}

## Selection rules

- One angle per high-signal opportunity. Do not stretch one signal into multiple angles.
- Pick 1 to N angles based on signal strength. If no interpretations qualify, emit \`{"angles": []}\`.
- Do not force a count. Quality over quantity.
- Pick platforms based on fit, not coverage. A pure shipping-engineering angle might land on hashnode/medium/devto. A community pulse-check might land on linkedin/discord. A short technical observation might land on hackernews/twitter only.
- Available platforms: ${platformList}.
- The angle is technical, not sales-y. The drafter will expand it.

## Voice profile

${formatVoiceProfile(voice)}

## Output contract

Respond with ONLY a raw JSON object. No markdown fences, no preamble, no commentary.

{
  "angles": [
    {
      "opportunity_signal": "<one of the report signals, verbatim or paraphrased>",
      "angle": "<crisp framing of the technical insight, one sentence>",
      "platforms": ["medium", "linkedin"]
    }
  ]
}

If no interpretations rise to angle quality, return \`{"angles": []}\`.

## Hard rules

${formatHardRules(ctx)}`;
}

/**
 * Build the angle-picker user prompt (pass 1).
 *
 * Carries the report context the picker reasons over. The signal-interpretation
 * section is the primary input; market snapshot and developer signals provide
 * supporting framing.
 *
 * @param args Report sections produced by Phase 4's trend-report pipeline.
 * @returns The user message body for the angle-picker pass.
 */
export function buildAnglePickerUserPrompt(args: {
	signalInterpretation: {
		text: string;
		interpretations: Array<{ signal: string; meaning: string; implication: string }>;
	};
	executiveSummary: string;
	marketSnapshot: string;
	developerSignals: string;
}): string {
	const interpretationsBlock = args.signalInterpretation.interpretations
		.map((entry, idx) => {
			return [
				`Interpretation ${idx + 1}:`,
				`  signal: ${entry.signal}`,
				`  meaning: ${entry.meaning}`,
				`  implication: ${entry.implication}`
			].join('\n');
		})
		.join('\n\n');

	return `## Report context

### Executive summary

${args.executiveSummary}

### Market snapshot

${args.marketSnapshot}

### Developer signals

${args.developerSignals}

### Signal interpretation

${args.signalInterpretation.text}

${interpretationsBlock || '(no interpretations were emitted)'}

## Your task

Pick 1 to N high-signal opportunities from the interpretations above. For each, name the angle and select the platforms it should target. Return only the JSON object specified in your system instructions.`;
}

/**
 * Build the drafter system prompt (pass 2).
 *
 * Receives the per-platform format specs ONLY for the platforms the picker
 * chose, plus voice samples scoped to the same platforms (mapped through to
 * voice formats). This keeps the prompt tight per call.
 *
 * @param ctx Operator context loaded from `loadOperatorContext()`.
 * @param voice Voice context loaded from `loadVoiceContext()` (for profile).
 * @param samples Voice samples keyed by `VoiceFormat`. Pass only the formats
 *   the chosen platforms map to.
 * @returns The full system prompt for the drafter pass.
 */
export function buildDrafterSystemPrompt(
	ctx: OperatorContext,
	voice: VoiceContext,
	samples: Partial<Record<VoiceFormat, string[]>>
): string {
	const orgName = ctx.orgName || 'the operator';
	const operatorRef = ctx.operatorName ? `${ctx.operatorName} at ${orgName}` : orgName;

	const selectedPlatforms = Object.entries(samples)
		.filter(([, list]) => Array.isArray(list) && list.length > 0)
		.map(([format]) => format);

	const formatSpecsBlock = ALL_CONTENT_PLATFORMS.filter((platform) =>
		platformIsSelectedFromSamples(platform, samples)
	)
		.map((platform) => PLATFORM_FORMAT_SPECS[platform])
		.join('\n\n');

	const fallbackSpecsBlock = formatSpecsBlock
		? formatSpecsBlock
		: '(No platforms preselected. Format specs will be injected via the user prompt instead.)';

	return `You are the content drafter for Pulsar, writing on behalf of ${operatorRef}.

## Who you serve

${ctx.positioning || `${orgName} positioning is supplied via operator context.`}

Your audience is: ${ctx.audience || 'configured via operator context.'}

## What you do

You receive a set of angles chosen by the angle-picker pass. Each angle names the opportunity, the framing, and the platforms it should target. You write the full content for each selected platform, matching the per-platform format spec exactly.

## Voice profile

${formatVoiceProfile(voice)}

## Voice samples (selected platforms only)

${formatVoiceSamples(samples)}

Match the operator voice. Mirror sentence patterns and avoid the phrasing flagged in "what never to write".

## Per-platform format specs

${fallbackSpecsBlock}

## Drafting rules

- Only write drafts for the platforms each angle selected. Do not produce content for platforms not on the list.
- Match the format spec exactly: word ranges, markdown rules, frontmatter, length.
- Echo \`opportunity_signal\` and \`angle\` verbatim from the input in your output, so the drafter output joins back to the picker output cleanly.
- Reference specific data points the report supports. No invented statistics.
- The reader is technical, time-constrained, and skeptical of hype. Numbers are evidence, not the point.

## Output contract

Respond with ONLY a raw JSON object. No markdown fences, no preamble, no commentary.

{
  "drafts": [
    {
      "opportunity_signal": "<echoed verbatim from input>",
      "angle": "<echoed verbatim from input>",
      "platforms": [
        {
          "platform": "<one of the selected platforms>",
          "content": "<full draft body>",
          "metadata": { /* per-platform metadata, see below */ }
        }
      ]
    }
  ]
}

### Per-platform metadata

- hashnode, medium, devto: { "tags": ["..."], "canonical_url": null | "https://..." }
- hackernews: {}
- linkedin: {}
- twitter: { "thread_count": <integer> }
- discord: {}

Inside each draft \`content\` string, escape literal double-quotes as \\" and literal newlines as \\n so the outer JSON parses cleanly.

## Hard rules

${formatHardRules(ctx)}

${selectedPlatforms.length > 0 ? `## Voice formats injected this call\n\n${selectedPlatforms.join(', ')}` : ''}`.trim();
}

/**
 * Build the drafter user prompt (pass 2).
 *
 * Carries the angles selected by pass 1 plus the report context the drafter
 * needs to ground the content (executive summary and market snapshot).
 *
 * @param args Selected angles and report context.
 * @returns The user message body for the drafter pass.
 */
export function buildDrafterUserPrompt(args: {
	angles: AngleChoice[];
	reportContext: { executiveSummary: string; marketSnapshot: string };
}): string {
	const anglesBlock = args.angles
		.map((entry, idx) => {
			return [
				`Angle ${idx + 1}:`,
				`  opportunity_signal: ${entry.opportunity_signal}`,
				`  angle: ${entry.angle}`,
				`  platforms: ${entry.platforms.join(', ')}`
			].join('\n');
		})
		.join('\n\n');

	return `## Selected angles

${anglesBlock || '(no angles to draft)'}

## Report context

### Executive summary

${args.reportContext.executiveSummary}

### Market snapshot

${args.reportContext.marketSnapshot}

## Your task

For each angle above, write the draft for every platform the angle selected. Echo the \`opportunity_signal\` and \`angle\` verbatim into the output. Return only the JSON object specified in your system instructions.`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map a content platform to the voice format the drafter should sample from.
 * The voice format taxonomy is broader than the content platform taxonomy:
 * long-form articles (hashnode, medium, devto) all share the long-form
 * voice format; hackernews short submissions live under `other`.
 */
const PLATFORM_TO_VOICE_FORMAT: Record<ContentPlatform, VoiceFormat> = {
	hashnode: 'long-form',
	medium: 'long-form',
	devto: 'long-form',
	hackernews: 'other',
	linkedin: 'linkedin',
	twitter: 'twitter',
	discord: 'discord'
};

export function voiceFormatForPlatform(platform: ContentPlatform): VoiceFormat {
	return PLATFORM_TO_VOICE_FORMAT[platform];
}

function platformIsSelectedFromSamples(
	platform: ContentPlatform,
	samples: Partial<Record<VoiceFormat, string[]>>
): boolean {
	const voiceFormat = PLATFORM_TO_VOICE_FORMAT[platform];
	const list = samples[voiceFormat];
	return Array.isArray(list) && list.length > 0;
}
