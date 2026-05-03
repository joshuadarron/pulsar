// ---------------------------------------------------------------------------
// Content-recommendations agent prompts (V2, two-pass)
//
// Pass 1 (`buildRecommendationSystemPrompt` + `buildRecommendationUserPrompt`):
//   The recommendation generator reads the full intelligence context plus the
//   trend report's narrative sections and produces a working brief: at least
//   four `{title, format, signal, angle, target, whyNow}` entries plus a
//   closing `prioritizationNote`. Voice profile only, no per-format samples.
//
// Pass 2 (`buildDrafterV2SystemPrompt` + `buildDrafterV2UserPrompt`):
//   The drafter takes ONE recommendation and writes drafts for the platforms
//   that match the recommendation's format (see `FORMAT_TO_PLATFORMS`). Voice
//   samples are scoped to the platforms targeted by this recommendation.
//
// Both passes interpolate operator identity, hard rules, and voice rules from
// `@pulsar/context` and `@pulsar/voice`. No operator-specific values are
// hardcoded here.
// ---------------------------------------------------------------------------

import type { OperatorContext } from '@pulsar/context';
import type {
	IntelligenceAuthor,
	IntelligenceContext,
	IntelligenceDiscussion,
	IntelligenceEntity,
	IntelligenceKeyword,
	IntelligenceTopicCluster,
	ProductContext
} from '@pulsar/context/types';
import type { ContentFormat, ContentRecommendation } from '@pulsar/shared/types';
import { ALL_CONTENT_FORMATS } from '@pulsar/shared/types';
import type { VoiceContext, VoiceFormat } from '@pulsar/voice';

import {
	type ContentPlatform,
	PLATFORM_FORMAT_SPECS,
	voiceFormatForPlatform
} from './content-drafts.js';

const SCRAPED_SITE_CHAR_LIMIT = 3000;

const STATIC_HARD_RULES: string[] = [
	'No em-dashes anywhere. Use commas, colons, periods, or parentheses instead.',
	'Lead with the technical insight, not the product pitch.',
	'One number per claim. Do not chain three statistics in a sentence.',
	'Cut hedging adjectives like "significantly", "substantially", "notably".',
	'Every claim must trace to either the intelligence data or the report context. No floating assertions.'
];

/**
 * Canonical mapping from a recommendation's format to the candidate set of
 * platforms the drafter should produce. The drafter stage looks up this map
 * for the active recommendation and only requests drafts for those platforms.
 */
export const FORMAT_TO_PLATFORMS: Record<ContentFormat, ContentPlatform[]> = {
	'blog-post': ['hashnode', 'medium', 'devto', 'linkedin'],
	tutorial: ['medium', 'devto', 'hashnode'],
	'medium-piece': ['medium'],
	'social-thread': ['twitter'],
	'video-tutorial': ['medium'],
	'short-post': ['linkedin', 'twitter', 'discord']
};

/**
 * For a content format, return the unique set of voice formats whose samples
 * the drafter should load. Mirrors `FORMAT_TO_PLATFORMS` then collapses each
 * platform onto its voice format.
 *
 * @param format The recommendation's content format.
 * @returns The deduplicated list of voice formats (preserves first-seen order).
 */
export function voiceFormatsForContentFormat(format: ContentFormat): VoiceFormat[] {
	const platforms = FORMAT_TO_PLATFORMS[format];
	const seen = new Set<VoiceFormat>();
	const ordered: VoiceFormat[] = [];
	for (const platform of platforms) {
		const voiceFormat = voiceFormatForPlatform(platform);
		if (seen.has(voiceFormat)) continue;
		seen.add(voiceFormat);
		ordered.push(voiceFormat);
	}
	return ordered;
}

function formatHardRules(ctx: OperatorContext): string {
	const merged = [...ctx.hardRules, ...STATIC_HARD_RULES];
	return merged.map((rule, idx) => `${idx + 1}. ${rule}`).join('\n');
}

function formatGroundingUrls(ctx: OperatorContext): string {
	if (ctx.groundingUrls.length === 0) {
		return 'No operator-specific grounding URLs configured.';
	}
	return ctx.groundingUrls.map((url) => `- ${url}`).join('\n');
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

function formatPeriod(window: { start: Date; end: Date }): string {
	const start = window.start instanceof Date ? window.start.toISOString() : String(window.start);
	const end = window.end instanceof Date ? window.end.toISOString() : String(window.end);
	return `${start} to ${end}`;
}

function formatEntityRow(entity: IntelligenceEntity, idx: number): string {
	const parts = [
		`${idx + 1}. ${entity.name} (${entity.type})`,
		`rank=${entity.pagerankRank}`,
		`pagerank=${entity.pagerankScore.toFixed(4)}`,
		`mentions=${entity.mentionCount}`
	];
	if (entity.history) {
		parts.push(
			`12mDelta=${entity.history.twelveMonthDelta}`,
			`yoyDelta=${entity.history.yoyDelta}`
		);
		const trajectory = entity.history.trajectory;
		if (Array.isArray(trajectory) && trajectory.length > 0) {
			const trajectoryLabel = trajectory
				.map((point) => `${point.period}:${point.mentions}`)
				.join(',');
			parts.push(`trajectory=${trajectoryLabel}`);
		}
	}
	return parts.join(' | ');
}

function formatKeywordRow(keyword: IntelligenceKeyword, idx: number): string {
	const parts = [
		`${idx + 1}. ${keyword.keyword}`,
		`count7d=${keyword.count7d}`,
		`count30d=${keyword.count30d}`,
		`delta=${keyword.delta}`
	];
	if (typeof keyword.velocitySpike === 'number') {
		parts.push(`velocitySpike=${keyword.velocitySpike}`);
	}
	return parts.join(' | ');
}

function formatTopicClusterRow(cluster: IntelligenceTopicCluster, idx: number): string {
	const topics = cluster.topTopics.length > 0 ? cluster.topTopics.join(', ') : '(no topics)';
	return `${idx + 1}. cluster #${cluster.clusterId} (${cluster.nodeCount} nodes): ${topics}`;
}

function formatDiscussionRow(discussion: IntelligenceDiscussion, idx: number): string {
	return `${idx + 1}. [${discussion.source}] ${discussion.title} (${discussion.commentCount} comments)`;
}

function formatAuthorRow(author: IntelligenceAuthor, idx: number): string {
	return `${idx + 1}. ${author.handle} on ${author.platform} (${author.articleCount} articles)`;
}

function formatPackages(product: ProductContext): string {
	if (product.packages.length === 0) {
		return '(no packages registered)';
	}
	return product.packages.map((pkg) => `- ${pkg.name}@${pkg.version}: ${pkg.summary}`).join('\n');
}

function truncateScrapedSite(content: string | undefined): string {
	if (!content) return '(no scraped site content available)';
	if (content.length <= SCRAPED_SITE_CHAR_LIMIT) return content;
	return `${content.slice(0, SCRAPED_SITE_CHAR_LIMIT)}\n\n[truncated at ${SCRAPED_SITE_CHAR_LIMIT} chars]`;
}

function formatList(label: string, items: string[]): string {
	if (items.length === 0) return `${label}: (none)`;
	return `${label}:\n${items.map((item) => `- ${item}`).join('\n')}`;
}

/**
 * Build the recommendation-generator system prompt (pass 1 of V2).
 *
 * Reads the full intelligence context plus the trend report's narrative and
 * produces at least four content recommendations plus a prioritization note.
 * Voice profile only, no per-format samples.
 *
 * @param ctx Operator context loaded from `loadOperatorContext()`.
 * @param voice Voice context loaded from `loadVoiceContext()`.
 * @returns The full system prompt for the recommendation pass.
 */
export function buildRecommendationSystemPrompt(ctx: OperatorContext, voice: VoiceContext): string {
	const orgName = ctx.orgName || 'the operator';
	const operatorRef = ctx.operatorName ? `${ctx.operatorName} at ${orgName}` : orgName;
	const formatList = ALL_CONTENT_FORMATS.join(' | ');

	return `You are the content recommendation generator for Pulsar, an intelligence system serving ${operatorRef}.

## Who you serve

${ctx.positioning || `${orgName} positioning is supplied via operator context.`}

Your audience is: ${ctx.audience || 'configured via operator context.'}

## Grounding URLs

${formatGroundingUrls(ctx)}

## What you do

You read the operator's intelligence context (entities, trending keywords, topic clusters, discussions, sentiment, authors, emerging topics) and the completed trend report's narrative sections. You produce a working brief of content recommendations the operator could publish from. Each recommendation names the piece, picks a format, cites the data point that justifies it, frames the technical angle, names the audience, and explains the urgency.

You do NOT write the drafts. The drafter pass takes one recommendation at a time and expands it into platform-specific drafts.

## How many recommendations to produce

Produce at least 4 recommendations. No upper bound. Pick a count that matches the strength and breadth of signals in the data. If five distinct signals deserve their own piece, write five. If eight do, write eight. Do not pad. Do not stretch one signal into multiple recommendations.

## Per-recommendation rules

- title: short, declarative, technical. The thing the piece will argue. No clickbait.
- format: exactly one of: ${formatList}.
- signal: cite a specific data point with EXACT NUMBERS. PageRank score, comment count, percentage delta, raw mention count. No prose handwaving. Reference the data, not the report's narrative.
- angle: articulate the technical position the operator should take. Not a paraphrase of the signal. The argument the piece will make.
- target: the audience for this specific piece. Be concrete about role and what they care about.
- whyNow: the urgency reasoning. Why this week, not next quarter. What is changing right now in the data that makes this timely.
- priorityHint (optional): "now", "this-week", or "durable" if the piece has a clear shelf-life signal.

## Closing prioritization note

After the recommendations, emit a 2 to 4 sentence \`prioritizationNote\` that mirrors the legacy report. Identify which items to publish first, which are durable, which have the shortest shelf life. Tie the order back to the data, not your taste.

## Voice profile

${formatVoiceProfile(voice)}

The voice profile applies to the title and angle phrasing. The drafter will get per-format samples; you only need the profile to pick titles that sound like the operator wrote them.

## Output contract

Respond with ONLY a raw JSON object. No markdown fences, no preamble, no commentary.

{
  "recommendations": [
    {
      "title": "<short, declarative, technical>",
      "format": "<one of: ${formatList}>",
      "signal": "<specific data point with EXACT NUMBERS>",
      "angle": "<technical position the operator should take>",
      "target": "<audience for this piece>",
      "whyNow": "<urgency reasoning>",
      "priorityHint": "now" | "this-week" | "durable"
    }
  ],
  "prioritizationNote": "<2 to 4 sentences ranking the recommendations by sequence and shelf life>"
}

The recommendations array must contain at least 4 entries.

## Hard rules

${formatHardRules(ctx)}`;
}

/**
 * Build the recommendation-generator user prompt (pass 1 of V2).
 *
 * Packs the intelligence context densely as labeled markdown sections so the
 * LLM can cite specific numbers. Includes the report sections too, but flags
 * that the intelligence numbers are the source of truth.
 *
 * @param args Intelligence context, product context, and report sections.
 * @returns The user message body for the recommendation pass.
 */
export function buildRecommendationUserPrompt(args: {
	intelligence: IntelligenceContext;
	product: ProductContext;
	reportSections: {
		executiveSummary: string;
		marketSnapshot: string;
		developerSignals: string;
		signalInterpretation: string;
	};
}): string {
	const { intelligence, product, reportSections } = args;

	const entitiesBlock = intelligence.entities
		.slice(0, 20)
		.map((entity, idx) => formatEntityRow(entity, idx))
		.join('\n');

	const keywordsBlock = intelligence.trendingKeywords
		.slice(0, 15)
		.map((keyword, idx) => formatKeywordRow(keyword, idx))
		.join('\n');

	const clustersBlock = intelligence.topicClusters
		.slice(0, 5)
		.map((cluster, idx) => formatTopicClusterRow(cluster, idx))
		.join('\n');

	const discussionsBlock = intelligence.topDiscussions
		.slice(0, 8)
		.map((discussion, idx) => formatDiscussionRow(discussion, idx))
		.join('\n');

	const authorsBlock = intelligence.topAuthors
		.slice(0, 5)
		.map((author, idx) => formatAuthorRow(author, idx))
		.join('\n');

	const sentiment = intelligence.sentimentBreakdown;
	const sentimentBlock = `positive=${sentiment.positive} | neutral=${sentiment.neutral} | negative=${sentiment.negative}`;

	const emergingBlock = formatList('Emerging topics', intelligence.emergingTopics);

	return `## Intelligence (source of truth)

The numbers below are the source of truth. The report sections further down show how a previous pass framed the same data; cite the numbers, not the framing.

### Window

period: ${formatPeriod(intelligence.period)}
articleCount: ${intelligence.articleCount}
sourceCount: ${intelligence.sourceCount}

### Top entities (PageRank, top 20)

${entitiesBlock || '(no entities in window)'}

### Trending keywords (top 15)

${keywordsBlock || '(no trending keywords in window)'}

### Topic clusters (top 5)

${clustersBlock || '(no topic clusters in window)'}

### Top discussions (top 8 by comment count)

${discussionsBlock || '(no discussions in window)'}

### Sentiment breakdown

${sentimentBlock}

### Top authors (top 5)

${authorsBlock || '(no authors in window)'}

### ${emergingBlock}

## Product context

### Positioning

${product.positioning || '(no positioning configured)'}

### Packages

${formatPackages(product)}

### Grounding URLs

${formatList('URLs', product.groundingUrls)}

### Scraped site content (truncated to ${SCRAPED_SITE_CHAR_LIMIT} chars)

${truncateScrapedSite(product.scrapedSiteContent)}

## Report sections (framing reference, not source of truth)

### Executive summary

${reportSections.executiveSummary}

### Market snapshot

${reportSections.marketSnapshot}

### Developer signals

${reportSections.developerSignals}

### Signal interpretation

${reportSections.signalInterpretation}

## Your task

Produce at least 4 content recommendations grounded in the intelligence numbers above. Each recommendation must cite a specific data point with EXACT NUMBERS in its \`signal\` field. Close with a 2 to 4 sentence \`prioritizationNote\`. Return only the JSON object specified in your system instructions.`;
}

/**
 * Build the V2 drafter system prompt (pass 2 of V2).
 *
 * Receives ONE recommendation. The system prompt includes per-platform format
 * specs ONLY for the platforms in the candidate set for this recommendation's
 * format, plus voice samples scoped to the same set.
 *
 * @param ctx Operator context loaded from `loadOperatorContext()`.
 * @param voice Voice context loaded from `loadVoiceContext()` (for profile).
 * @param samples Voice samples keyed by `VoiceFormat`. Pass only the formats
 *   the candidate platforms map to.
 * @returns The full system prompt for the V2 drafter pass.
 */
export function buildDrafterV2SystemPrompt(
	ctx: OperatorContext,
	voice: VoiceContext,
	samples: Partial<Record<VoiceFormat, string[]>>
): string {
	const orgName = ctx.orgName || 'the operator';
	const operatorRef = ctx.operatorName ? `${ctx.operatorName} at ${orgName}` : orgName;

	const selectedVoiceFormats = Object.entries(samples)
		.filter(([, list]) => Array.isArray(list) && list.length > 0)
		.map(([format]) => format as VoiceFormat);

	const selectedPlatforms = (Object.keys(PLATFORM_FORMAT_SPECS) as ContentPlatform[]).filter(
		(platform) => selectedVoiceFormats.includes(voiceFormatForPlatform(platform))
	);

	const formatSpecsBlock = selectedPlatforms
		.map((platform) => PLATFORM_FORMAT_SPECS[platform])
		.join('\n\n');

	const fallbackSpecsBlock = formatSpecsBlock
		? formatSpecsBlock
		: '(No platforms preselected. Format specs will be injected via the user prompt instead.)';

	const platformListLine =
		selectedPlatforms.length > 0 ? selectedPlatforms.join(', ') : '(none, see user prompt)';

	return `You are the content drafter for Pulsar, writing on behalf of ${operatorRef}.

## Who you serve

${ctx.positioning || `${orgName} positioning is supplied via operator context.`}

Your audience is: ${ctx.audience || 'configured via operator context.'}

## What you do

You receive ONE content recommendation: {title, format, signal, angle, target, whyNow}. Write platform-appropriate drafts that deliver on the title and angle, while citing the signal verbatim where natural. The recommendation has already picked the format; your job is to render that format on the platforms it maps to.

## Voice profile

${formatVoiceProfile(voice)}

## Voice samples (selected platforms only)

${formatVoiceSamples(samples)}

Match the operator voice. Mirror sentence patterns and avoid the phrasing flagged in "what never to write".

## Per-platform format specs

${fallbackSpecsBlock}

## Active platforms for this recommendation

${platformListLine}

## Drafting rules

- Only write drafts for the platforms listed above. Do not produce content for any other platform.
- Match the format spec exactly: word ranges, markdown rules, frontmatter, length.
- Deliver on the recommendation's \`title\` and \`angle\`. Cite the \`signal\` verbatim where it lands naturally.
- Reference specific data points the recommendation cites. No invented statistics.
- The reader is technical, time-constrained, and skeptical of hype. Numbers are evidence, not the point.

## Output contract

Respond with ONLY a raw JSON object. No markdown fences, no preamble, no commentary. The drafts apply to a single recommendation, so do NOT wrap them in an outer \`drafts\` array.

{
  "platforms": [
    {
      "platform": "<one of the active platforms>",
      "content": "<full draft body>",
      "metadata": { /* per-platform metadata, see below */ }
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

${formatHardRules(ctx)}`;
}

/**
 * Build the V2 drafter user prompt (pass 2 of V2).
 *
 * Echoes the recommendation in full and provides brief report context. The
 * candidate platform list is passed explicitly so the drafter knows which
 * platforms to render for this call.
 *
 * @param args The single recommendation and the report context snippets.
 * @returns The user message body for the V2 drafter pass.
 */
export function buildDrafterV2UserPrompt(args: {
	recommendation: ContentRecommendation;
	reportContext: {
		executiveSummary: string;
		marketSnapshot: string;
	};
}): string {
	const { recommendation, reportContext } = args;
	const platforms = FORMAT_TO_PLATFORMS[recommendation.format];
	const platformList = platforms.length > 0 ? platforms.join(', ') : '(no platforms mapped)';
	const priorityLine = recommendation.priorityHint
		? `\n  priorityHint: ${recommendation.priorityHint}`
		: '';

	return `## Recommendation

title: ${recommendation.title}
format: ${recommendation.format}
signal: ${recommendation.signal}
angle: ${recommendation.angle}
target: ${recommendation.target}
whyNow: ${recommendation.whyNow}${priorityLine}

## Report context

### Executive summary

${reportContext.executiveSummary}

### Market snapshot

${reportContext.marketSnapshot}

## Your task

Produce drafts for these platforms only: ${platformList}.

Deliver on the recommendation's \`title\` and \`angle\`. Cite the \`signal\` verbatim where it lands naturally. Return only the JSON object specified in your system instructions.`;
}
