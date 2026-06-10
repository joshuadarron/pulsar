// ---------------------------------------------------------------------------
// Article-package agent prompts (three-pass).
//
// Pass 1 (`buildArticlePickerSystemPrompt` + `buildArticlePickerUserPrompt`):
//   Reads the completed trend report's signal interpretations and the
//   series state (recent metaphor families, Medium publication queue,
//   published articles). Picks 1 to N article specs. Each spec carries:
//   opportunity_signal, angle, proposed_title, proposed_subtitle, an
//   assigned metaphor family (respecting rotation), an assigned primary
//   Medium publication (respecting queue saturation), and cross-reference
//   candidates from previously-published articles.
//
// Pass 2 (`buildArticleWriterSystemPrompt` + `buildArticleWriterUserPrompt`):
//   Takes one spec and writes the article body in markdown. Receives the
//   operator voice profile and the long-form voice samples so the body
//   matches operator voice. Emits a finalized title, subtitle, and body.
//
// Pass 3 (`buildArticleAnnotatorSystemPrompt` + `buildArticleAnnotatorUserPrompt`):
//   Takes the finalized body and writes the companion markdown files:
//   quotes_md (pull quotes with placement anchors), images_md (four
//   Midjourney prompts using the spec's metaphor family), publications_md
//   (ranked publication targets). Pull-quote placement and image section
//   anchors reference the locked-in body verbatim.
//
// All operator-specific values (identity, voice, positioning, hard rules,
// long-form samples) come from `@pulsar/operator-context` and
// `@pulsar/voice`. Nothing in this file is hardcoded to a specific
// operator.
// ---------------------------------------------------------------------------

import type { OperatorContext } from '@pulsar/context';
import type { VoiceContext } from '@pulsar/voice';

// ---------------------------------------------------------------------------
// Metaphor families and publications
// ---------------------------------------------------------------------------

export type MetaphorFamily =
	| 'industrial-mechanical'
	| 'nature-ecology'
	| 'space-astronomy'
	| 'video-games-digital-play'
	| 'ocean-maritime'
	| 'geometric-abstract'
	| 'architecture-infrastructure'
	| 'textile-craft'
	| 'geology-earth-sciences'
	| 'music-acoustics'
	| 'cartography-exploration'
	| 'botanical-illustration'
	| 'culinary-kitchen'
	| 'sports-strategy'
	| 'theater-stagecraft'
	| 'transportation-locomotion'
	| 'library-archival'
	| 'scientific-laboratory'
	| 'watchmaking-horology'
	| 'postal-communication';

export const METAPHOR_FAMILIES: readonly MetaphorFamily[] = [
	'industrial-mechanical',
	'nature-ecology',
	'space-astronomy',
	'video-games-digital-play',
	'ocean-maritime',
	'geometric-abstract',
	'architecture-infrastructure',
	'textile-craft',
	'geology-earth-sciences',
	'music-acoustics',
	'cartography-exploration',
	'botanical-illustration',
	'culinary-kitchen',
	'sports-strategy',
	'theater-stagecraft',
	'transportation-locomotion',
	'library-archival',
	'scientific-laboratory',
	'watchmaking-horology',
	'postal-communication'
] as const;

export const METAPHOR_FAMILY_DESCRIPTIONS: Record<MetaphorFamily, string> = {
	'industrial-mechanical':
		'workshops, engines, tools, factories, mechanical instruments, gears, presses',
	'nature-ecology':
		'forests, ecosystems, animal communities, mycelial networks, seasonal cycles, weather',
	'space-astronomy':
		'orbital systems, telescopes, star maps, satellites, planetary motion, deep space observation',
	'video-games-digital-play':
		'consoles, debug overlays, modding, game cartridges, pixel art worlds, controller interfaces',
	'ocean-maritime':
		'depths, currents, marine biology, navigation, lighthouses, shipwrecks, coral reefs, submarine views',
	'geometric-abstract':
		'tessellations, fractals, polyhedra, lattices, isometric grids, mathematical patterns',
	'architecture-infrastructure':
		'buildings in cross-section, bridges, tunnels, urban planning, structural engineering, scaffolding',
	'textile-craft':
		'weaving, embroidery, quilting, knotwork, looms, knitted patterns, sewing notions',
	'geology-earth-sciences':
		'strata, cave systems, mineral formations, fossils, plate tectonics, archaeological digs',
	'music-acoustics':
		'sheet music, instrument cross-sections, sound waves, concert halls, conductor scores, vintage recording equipment',
	'cartography-exploration':
		'antique maps, compasses, expedition routes, surveyor tools, atlas pages, navigation instruments',
	'botanical-illustration':
		'plant anatomy, seed dispersal, root systems, flower diagrams, herbarium plates, greenhouse interiors',
	'culinary-kitchen':
		'knife work, mise en place, fermentation, baking processes, kitchen tools, pantry organization',
	'sports-strategy':
		'chessboards, fencing, archery, billiards, gymnastics rigs, scoreboards, athletic equipment',
	'theater-stagecraft':
		'backstage views, lighting rigs, set design, prop tables, curtain mechanisms, marionettes',
	'transportation-locomotion':
		'trains, sailing ships, bicycles, hot air balloons, vintage cars, switching yards',
	'library-archival':
		'bookshelves, card catalogs, manuscript pages, scriptoriums, reading rooms, book restoration',
	'scientific-laboratory':
		'glassware, microscopes, specimen jars, lab notebooks, chromatography, balance scales',
	'watchmaking-horology':
		'clockwork, escapements, gear trains, sundials, tower clocks, pocket watch interiors',
	'postal-communication':
		'telegraphs, pneumatic tubes, post offices, letter sorting, carrier pigeons, signal towers'
};

export type MediumPublication = 'Level Up Coding' | 'AI Advances' | 'Stackademic' | 'ITNext';

export const MEDIUM_PUBLICATIONS: readonly MediumPublication[] = [
	'Level Up Coding',
	'AI Advances',
	'Stackademic',
	'ITNext'
] as const;

// ---------------------------------------------------------------------------
// Series state and contract types
// ---------------------------------------------------------------------------

export type PublishedArticleRef = {
	slug: string;
	title: string;
	angle: string;
	/** Optional URL for operator-curated entries from `.context/past-articles.md`. */
	url?: string;
};

export type SeriesState = {
	recentMetaphorFamilies: MetaphorFamily[];
	mediumPublicationQueue: Record<string, string>;
	publishedArticles: PublishedArticleRef[];
};

export type ArticleSpec = {
	article_slug: string;
	opportunity_signal: string;
	angle: string;
	proposed_title: string;
	proposed_subtitle: string;
	metaphor_family: MetaphorFamily;
	primary_medium_pub: MediumPublication | null;
	cross_ref_candidates: string[];
};

export type ArticleBody = {
	title: string;
	subtitle: string;
	content_md: string;
};

export type ArticleAnnotation = {
	quotes_md: string;
	images_md: string;
	publications_md: string;
};

// ---------------------------------------------------------------------------
// Static guidance shared across all three passes
// ---------------------------------------------------------------------------

const STATIC_HARD_RULES: string[] = [
	'No em-dashes anywhere. Use commas, colons, periods, or parentheses instead.',
	'Lead with what is built or being argued, not with credentials or titles.',
	'One number per claim. Do not chain three statistics in a sentence.',
	'Skip beginner caveats unless the spec explicitly requests them.',
	'Every claim must trace to the report context or a research citation. No floating assertions.',
	'Never describe the operator product as a platform when the operator context defines it as a runtime.'
];

const ARTICLE_STRUCTURE_RULES: string = [
	'Standard section pattern for argumentative or positioning pieces:',
	'  1. Opening (no header). Two to four paragraphs that establish the moment, the pattern, or the problem. Lead with a concrete observation, not an abstract claim.',
	'  2. Context paragraph. One or two paragraphs grounding the post in real systems, real data, or real builds. If the post is about Pulsar or RocketRide work, briefly introduce the project and link the repo. If the post is about a market signal, name the signal and its source.',
	'  3. Body sections. Three to six headed sections. Each opens with a clear claim and supports it with technical specifics, concrete examples, or worked-through scenarios.',
	'  4. Worked example or concrete demonstration. Use real systems where possible. Synthetic examples must be labeled as illustrative.',
	'  5. Honest limit section (optional). When the argument is strong, acknowledge what the argument does not cover.',
	'  6. What to do recommendations. Three concrete actions the reader can take. Numbered or bulleted.',
	'  7. Operator reveal section, when warranted. Include a closing reveal section that names the operator product only when the article\'s argument genuinely intersects with the operator\'s positioning. When the argument is pure developer content that does not lean on operator positioning, omit the reveal entirely and let the piece stand on its own merits. When you do include a reveal, throughout the rest of the post refer to the operator product as "the AI runtime I work on" or "the open-source AI runtime I build on"; name the operator product only in the closing reveal section, link the repo, and pivot immediately to why the lesson is runtime-agnostic so the post does not read as a bait-and-switch. Across a run of three article specs, aim for at most one with a reveal; the other two should stand alone.',
	'  8. Cross-references. Where the argument connects to other posts, link to them inline with anchor text that explains what the reader will find on the other end. Avoid generic "read more" links.',
	'',
	'Length target: 1500 to 2500 words for argumentative or positioning pieces. 1800 to 2500 words for narrative pieces. Up to 4000 words for technical tutorials with code.',
	'',
	'Resources footnote: if the post draws on external discussions or data sources, describe the pattern in general terms in the body and list the specific sources in a Resources section at the end. The body should stay durable; reactive references age out.',
	'',
	'Title format: sentence-case or title-case, claim-forward, specific. Strong titles are claims the reader wants to verify. Avoid leading with "I" or "How to" unless the personal angle is the actual hook.',
	'',
	'Subtitle format: italicized single sentence directly below the title. Names what kind of post this is, sets up the structure, ideally telegraphs the central tension. The subtitle is not the thesis; it is the framing.'
].join('\n');

const PULL_QUOTE_RULES: string = [
	'Pull quote selection principles:',
	'- The number of pull quotes is decided by the article weight, not a fixed count. Short tactical posts may need two or three. Long positioning pieces may justify six or more.',
	'- Each quote is one sentence.',
	'- Each quote is placed mid-section, not as the last line of a section.',
	'- Quotes can be paraphrased or lightly reworded from the canonical body for emphasis and sharpness.',
	'- At least one quote isolates the post thesis or central framing.',
	'- Other quotes name the problem, the analytical framework, the practical implication, and (when relevant) the urgency driver or action prompt.',
	'- At least one quote should be specific enough to work as a standalone screenshot on social media.',
	'- At least one quote should generalize beyond the post topic (transferable insight).',
	'- Quotes should not duplicate each other. Each one carries a distinct beat.',
	'- Together, the selected quotes should give a reader who only scrolls the callouts the full argument of the post.',
	'',
	'Quote file format. For each quote, document the section it belongs to, the exact paragraph after which the quote appears (use a verbatim ending phrase from that paragraph as the anchor), the quote in blockquote form, and a brief rationale for why this quote was chosen and any rewording from the canonical.'
].join('\n');

const IMAGE_STYLE_RULES: string = [
	'Image style direction (consistent across all articles):',
	'- Editorial illustration aesthetic, New Yorker or Wired magazine feature spread style.',
	'- Flat illustration with subtle paper texture.',
	'- Restrained palette: deep navy blue background, muted teal blue for primary elements, warm amber for emphasis and accents.',
	'- No people, no figures, no faces.',
	'- No text, no words, no logos, no readable numbers.',
	'- Concrete real-world metaphors, never abstract shapes.',
	'',
	'Image count and placement: exactly four images per post. One cover plus three section anchors. The cover doubles as the LinkedIn link preview (generate a 1:1 square version of the cover separately for LinkedIn).',
	'',
	'Midjourney prompt structure:',
	'- Open with "Editorial illustration".',
	'- Describe the scene in detailed comma-separated phrases.',
	'- Specify the color palette using the established navy/teal/amber framework.',
	'- Name the magazine style reference (New Yorker or Wired).',
	'- Specify "flat illustration with subtle paper texture".',
	'- Close with parameters: --ar 16:9 --style raw --no text, words, logos, watermark, signature, humans, faces',
	'- Add "readable text, numbers" to the no list when the scene risks generating text.',
	'',
	'Caption format:',
	'- One sentence (occasionally two if the second sentence is short).',
	'- Captions add commentary or compress the post argument, never describe the image.',
	'- Slightly wry or quotable when the post tone allows.',
	'- Italicized.',
	'',
	'Image file format. For each image document: image number and role (Cover, or "For [section name]"), placement instructions (exact section and position in the body), a one-paragraph concept description in plain prose explaining the visual metaphor, the Midjourney prompt in a fenced code block, and the caption with placement note. Close the file with a summary table of all four images (section, placement, caption), a Midjourney generation tips section (common failure modes, regeneration suggestions, palette correction techniques), and a series visual variety note (this article metaphor family plus which families were used in the previous three to five articles).'
].join('\n');

const PUBLICATION_RULES: string = [
	'Standard publications considered:',
	'',
	'Medium publications:',
	'- Level Up Coding (contributor access).',
	'- AI Advances (requires writer form submission first, then direct submission).',
	'- Stackademic.',
	'- ITNext.',
	'',
	'Non-Medium targets:',
	'- Hashnode (canonical home for the series).',
	'- Dev.to (republish with canonical_url).',
	'- Hacker News (submission with prepared first comment).',
	'- Relevant subreddits (r/programming, r/devops, r/MachineLearning, r/LocalLLaMA, etc.).',
	'',
	'Ranking principles:',
	'- Each post gets a primary Medium publication based on topic fit. The picker pre-selects this from the queue state; the annotator confirms or downgrades to none if no good fit exists.',
	'- Hashnode is always the canonical home.',
	'- Dev.to and Medium under personal profile always republish with canonical_url set to the Hashnode URL.',
	'- Hacker News submission only when the post earns it (claim-forward title, technically grounded, willing to engage with comments).',
	'- Subreddit crossposts only where the topic aligns with the community.',
	'',
	'Hacker News submission strategy. Title should be a specific claim, not a how-to or "Show HN". Avoid leading with "I". Prepare a first comment to post immediately after submission that acknowledges any conflict of interest, pre-empts the most predictable critique, and frames the analytical contribution clearly. Block out time on submission day to respond to comments.',
	'',
	'Publication file format. For each target document: publication name, fit assessment (Strong, Strong with caveats, Medium, Low), reasoning for the assessment, any constraints (queue limits, writer form requirements), recommended submission language or framing, risk level and mitigation. Close the file with a suggested submission sequence (the order of operations from canonical publication through all distribution channels) and a series-level publication conflict update tracking which Medium publications have been assigned to which posts so the next article can avoid queue saturation.'
].join('\n');

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

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

function formatLongFormSamples(voice: VoiceContext): string {
	const list = voice.samples['long-form'];
	if (!list || list.length === 0) {
		return 'No long-form voice samples loaded. Match the voice profile rules above as the primary signal.';
	}
	const sections: string[] = [];
	for (let i = 0; i < list.length; i += 1) {
		sections.push(`### Sample ${i + 1}`);
		sections.push(list[i].trim());
		sections.push('');
	}
	return sections.join('\n').trim();
}

function formatMetaphorFamilyList(): string {
	const lines: string[] = [];
	METAPHOR_FAMILIES.forEach((family, idx) => {
		lines.push(`${idx + 1}. ${family}: ${METAPHOR_FAMILY_DESCRIPTIONS[family]}`);
	});
	return lines.join('\n');
}

function formatOperatorIdentity(ctx: OperatorContext): string {
	const orgName = ctx.orgName || 'the operator';
	const author = ctx.authorIdentity
		? `${ctx.operatorName || 'the operator'}, ${ctx.authorIdentity}`
		: ctx.operatorName || 'the operator';
	const anchor = ctx.anchorPhrase ? `Anchor phrase: "${ctx.anchorPhrase}"` : '';
	const positioning = ctx.positioning || `${orgName} positioning is supplied via operator context.`;
	const audience = ctx.audience || 'configured via operator context.';
	return [
		`Author identity: ${author}.`,
		anchor,
		`Positioning: ${positioning}`,
		`Audience: ${audience}`
	]
		.filter((line) => line.length > 0)
		.join('\n');
}

const PUBLISHED_ARTICLES_DEDUP_WINDOW = 8;

function formatPublishedArticles(state: SeriesState): string {
	if (state.publishedArticles.length === 0) {
		return '(no prior articles published in this series yet)';
	}
	// The dedup signal that matters for the picker is "did we already cover this
	// angle in the last few weeks", not the full history of the series. Trim to
	// the most recent N so the prompt stays focused as the series grows.
	const recent = state.publishedArticles.slice(-PUBLISHED_ARTICLES_DEDUP_WINDOW);
	return recent
		.map((ref, idx) => {
			const linkPart = ref.url ? ` (${ref.url})` : '';
			return `${idx + 1}. [${ref.slug}]${linkPart} ${ref.title} - angle: ${ref.angle}`;
		})
		.join('\n');
}

function formatMediumQueue(state: SeriesState): string {
	const entries = Object.entries(state.mediumPublicationQueue);
	if (entries.length === 0) {
		return '(no Medium publications assigned yet)';
	}
	return entries.map(([pub, when]) => `- ${pub}: last assigned ${when}`).join('\n');
}

function formatRecentMetaphorFamilies(state: SeriesState): string {
	if (state.recentMetaphorFamilies.length === 0) {
		return '(no metaphor families used recently)';
	}
	return state.recentMetaphorFamilies.map((family, idx) => `${idx + 1}. ${family}`).join('\n');
}

// ---------------------------------------------------------------------------
// Pass 1: Article picker
// ---------------------------------------------------------------------------

/**
 * Build the picker system prompt. The picker reads the trend report plus
 * the series state and emits an array of article specs.
 *
 * @param ctx Operator context loaded from `loadOperatorContext()`.
 * @param voice Voice context loaded from `loadVoiceContext(['long-form'])`.
 * @param state Series state loaded from postgres.
 * @returns The full system prompt for the picker pass.
 */
export function buildArticlePickerSystemPrompt(
	ctx: OperatorContext,
	voice: VoiceContext,
	state: SeriesState
): string {
	const familyList = formatMetaphorFamilyList();
	const recentFamilies = formatRecentMetaphorFamilies(state);
	const queueState = formatMediumQueue(state);
	const publishedList = formatPublishedArticles(state);
	const mediumList = MEDIUM_PUBLICATIONS.join(', ');

	return `You are the article picker for Pulsar, an intelligence system that produces a small number of publishable articles per report.

## Who you serve

${formatOperatorIdentity(ctx)}

## What you do

You read the completed market trend report (executive summary, market snapshot, developer signals, signal interpretations). You pick 1 to N high-signal opportunities and produce one article spec per opportunity. The downstream writer and annotator passes turn each spec into a full four-file article package.

Volume is the enemy. Prefer fewer well-shaped article specs over many weak ones. If no interpretations rise to the bar, emit \`{"articles": []}\`.

Each article spec must derive from a distinct upstream signal: when the trend report provides \`signalInterpretation.narrative\`, each spec must derive from a different narrative paragraph; in the legacy shape, each spec must derive from a different interpretation entry. Do not emit two specs that hinge on the same upstream signal, even when the signal is rich enough to support two angles.

## Voice profile (used to gauge angle fit, not for writing)

${formatVoiceProfile(voice)}

## Each spec must include

1. article_slug: a kebab-case slug derived from the angle. Stable, unique within this report, no dates.
2. opportunity_signal: the report signal this article responds to (echo verbatim or paraphrase tightly).
3. angle: one crisp, technical sentence framing what the piece will argue. This is the claim the reader will verify.
4. proposed_title: claim-forward, specific. Avoid leading with "I" or "How to" unless the personal angle is the actual hook.
5. proposed_subtitle: a single italicized sentence that telegraphs the central tension. Not the thesis.
6. metaphor_family: chosen from the allowed list below, obeying the rotation rule.
7. primary_medium_pub: one of [${mediumList}] or null when no Medium queue slot fits.
8. cross_ref_candidates: an array of zero or more article_slug values from the published articles list below. Pick only when the new article argument genuinely connects to a published article argument.

## Metaphor family rotation rules

- The picker assigns one metaphor family per article spec.
- Do not use any metaphor family that appears in the recent metaphor families list below.
- Do not repeat a metaphor family within a single picker response (across the N specs you emit).
- Prefer families that fit the article argument naturally. A protocol post fits standardization metaphors; a debugging post fits observation metaphors; a story about scale fits growth metaphors.
- When multiple families fit, prefer the less expected family. Surprising visual metaphors land harder than safe ones.

### Allowed metaphor families

${familyList}

### Recent metaphor families (excluded for this run)

${recentFamilies}

## Primary Medium publication assignment rules

- Each spec gets a primary Medium publication assignment or null.
- The available Medium publications are: ${mediumList}.
- Do not assign a Medium publication that received an article within the last 5 weeks (see the queue state below).
- Do not assign the same Medium publication to two specs in this response.
- If no available publication fits the angle, assign null. The annotator will record alternatives in publications.md.

### Medium publication queue state

${queueState}

## Cross-reference candidates

Pick from the published articles list below ONLY when the new article makes an argument that genuinely connects to a prior article argument. Do not force cross-references. Empty array is the right answer most of the time.

### Published articles in this series

${publishedList}

## Angle deduplication

For each candidate article, compare its proposed angle to the \`angle:\` field of every entry in the published articles list above. If a candidate angle paraphrases or covers the same ground as a recent published angle, drop the candidate. Look for semantic overlap, not just literal string match: "the runtime is the execution layer" and "what sits beneath the framework matters more than the framework" are the same angle. Returning fewer specs (or zero) is the right answer when the current period's signals would force you to repeat. Do not pad to hit a count.

## Output contract

Respond with ONLY a raw JSON object. No markdown fences, no preamble, no commentary.

{
  "articles": [
    {
      "article_slug": "kebab-case-slug",
      "opportunity_signal": "<signal verbatim or paraphrased>",
      "angle": "<one technical sentence>",
      "proposed_title": "<claim-forward title>",
      "proposed_subtitle": "<italicized framing sentence, do not include the asterisks>",
      "metaphor_family": "<one of the allowed families>",
      "primary_medium_pub": "Level Up Coding" | "AI Advances" | "Stackademic" | "ITNext" | null,
      "cross_ref_candidates": ["slug-of-prior-article", "..."]
    }
  ]
}

If no interpretations rise to article quality, emit \`{"articles": []}\`.

## Hard rules

${formatHardRules(ctx)}`;
}

/**
 * Build the picker user prompt carrying the report context. The picker
 * reasons over the signal interpretations primarily; the other sections
 * provide framing.
 */
export function buildArticlePickerUserPrompt(args: {
	signalInterpretation: {
		text: string;
		narrative?: string[];
		interpretations?: Array<{ signal: string; meaning: string; implication: string }>;
	};
	executiveSummary: string;
	marketSnapshot: string;
	developerSignals: string;
}): string {
	const narrative = args.signalInterpretation.narrative ?? [];
	const interpretations = args.signalInterpretation.interpretations ?? [];

	let signalsBlock: string;
	if (narrative.length > 0) {
		signalsBlock = narrative
			.map((paragraph, idx) => `Narrative ${idx + 1}:\n${paragraph}`)
			.join('\n\n');
	} else if (interpretations.length > 0) {
		signalsBlock = interpretations
			.map((entry, idx) =>
				[
					`Interpretation ${idx + 1}:`,
					`  signal: ${entry.signal}`,
					`  meaning: ${entry.meaning}`,
					`  implication: ${entry.implication}`
				].join('\n')
			)
			.join('\n\n');
	} else {
		signalsBlock = '(no interpretations were emitted)';
	}

	return `## Report context

### Executive summary

${args.executiveSummary}

### Market snapshot

${args.marketSnapshot}

### Developer signals

${args.developerSignals}

### Signal interpretation

${args.signalInterpretation.text}

${signalsBlock}

## Your task

Pick 1 to N high-signal opportunities from the signal interpretation above. For each, emit a full article spec following the rules in your system instructions. Return only the JSON object specified in your system instructions.`;
}

// ---------------------------------------------------------------------------
// Pass 2: Article writer
// ---------------------------------------------------------------------------

/**
 * Build the writer system prompt. The writer receives the operator voice
 * profile and long-form samples and produces the article body (title,
 * subtitle, content_md) for one spec at a time.
 */
export function buildArticleWriterSystemPrompt(ctx: OperatorContext, voice: VoiceContext): string {
	return `You are the article writer for Pulsar, writing on behalf of the operator below.

## Who you serve

${formatOperatorIdentity(ctx)}

## What you do

You receive one article spec (opportunity signal, angle, proposed title and subtitle, the metaphor family that will drive its images, the primary Medium publication assigned, and any cross-reference candidates). You write the full article body in markdown. You do not write quotes, image prompts, or publication ranking - the annotator pass handles those.

## Voice profile

${formatVoiceProfile(voice)}

## Long-form voice samples

${formatLongFormSamples(voice)}

Match the operator voice. Mirror sentence patterns. Avoid the phrasing flagged in "what never to write".

## Article structure rules

${ARTICLE_STRUCTURE_RULES}

## Cross-references

If the spec includes cross_ref_candidates, weave inline links to those articles where the argument genuinely connects. Use anchor text that explains what the reader will find on the other end. Do not force cross-references.

## Output contract

Respond with ONLY a raw JSON object. No markdown fences, no preamble, no commentary.

{
  "title": "<final title, may refine the proposed_title>",
  "subtitle": "<final subtitle, may refine the proposed_subtitle. Do not include the italic asterisks. The renderer adds them.>",
  "content_md": "<full article body in markdown, including all sections, the runtime reveal section, and any Resources footnote. Escape literal double-quotes as \\" and literal newlines as \\n so the outer JSON parses cleanly.>"
}

The content_md value does NOT include the title or subtitle (those go in their own fields). Start content_md with the opening paragraphs of the post, no header.

## Hard rules

${formatHardRules(ctx)}`;
}

/**
 * Build the writer user prompt carrying one article spec and the report
 * context the writer needs to ground the body.
 */
export function buildArticleWriterUserPrompt(args: {
	spec: ArticleSpec;
	reportContext: { executiveSummary: string; marketSnapshot: string };
	crossRefs: PublishedArticleRef[];
}): string {
	const crossRefBlock =
		args.crossRefs.length === 0
			? '(no cross-references)'
			: args.crossRefs
					.map((ref) => {
						const linkPart = ref.url ? ` (${ref.url})` : '';
						return `- [${ref.slug}]${linkPart} ${ref.title} - argument: ${ref.angle}`;
					})
					.join('\n');

	return `## Article spec

article_slug: ${args.spec.article_slug}
opportunity_signal: ${args.spec.opportunity_signal}
angle: ${args.spec.angle}
proposed_title: ${args.spec.proposed_title}
proposed_subtitle: ${args.spec.proposed_subtitle}
metaphor_family: ${args.spec.metaphor_family}
primary_medium_pub: ${args.spec.primary_medium_pub ?? 'none'}

## Cross-reference candidates

${crossRefBlock}

## Report context

### Executive summary

${args.reportContext.executiveSummary}

### Market snapshot

${args.reportContext.marketSnapshot}

## Your task

Write the full article body for this spec. Match the voice profile and the long-form samples in your system instructions. Follow the article structure rules exactly: opening, context, body sections, worked example, optional honest limit, what-to-do recommendations, runtime reveal at the close, and any cross-reference inline links. Return only the JSON object specified in your system instructions.`;
}

// ---------------------------------------------------------------------------
// Pass 3: Article annotator
// ---------------------------------------------------------------------------

/**
 * Build the annotator system prompt. The annotator receives the finalized
 * body and writes the three companion markdown files (quotes, images,
 * publications) grounded on the locked-in body.
 */
export function buildArticleAnnotatorSystemPrompt(
	ctx: OperatorContext,
	voice: VoiceContext,
	state: SeriesState
): string {
	return `You are the article annotator for Pulsar, writing the companion files for an article body that has already been finalized.

## Who you serve

${formatOperatorIdentity(ctx)}

## What you do

You receive one article spec plus the finalized title, subtitle, and body. You produce three markdown files:

1. quotes_md: pull quotes with placement anchors.
2. images_md: four Midjourney prompts (cover plus three section anchors) using the metaphor family assigned in the spec.
3. publications_md: ranked publication targets with fit assessments and a submission sequence.

You do not modify the body. All three files reference the body verbatim where placement matters.

## Voice profile (informs caption tone and submission framing)

${formatVoiceProfile(voice)}

## Pull-quote rules

${PULL_QUOTE_RULES}

## Image rules

${IMAGE_STYLE_RULES}

### Metaphor families (use the one assigned in the spec only)

${formatMetaphorFamilyList()}

### Recent metaphor families (for the series visual variety note)

${formatRecentMetaphorFamilies(state)}

## Publication rules

${PUBLICATION_RULES}

### Medium publication queue state (for the publication conflict update)

${formatMediumQueue(state)}

## Output contract

Respond with ONLY tagged sections in the exact format below. No JSON, no preamble, no commentary, no outer code fences. Each section's body is raw markdown with no escaping; the literal delimiters separate the three files.

<<<QUOTES_MD>>>
<full quotes.md markdown body here, with no escaping>
<<<END_QUOTES_MD>>>

<<<IMAGES_MD>>>
<full images.md markdown body here, with no escaping>
<<<END_IMAGES_MD>>>

<<<PUBLICATIONS_MD>>>
<full publications.md markdown body here, with no escaping>
<<<END_PUBLICATIONS_MD>>>

The opening delimiter (<<<QUOTES_MD>>> etc.) appears on its own line. The closing delimiter (<<<END_QUOTES_MD>>> etc.) also appears on its own line. Between the delimiters, write the file body verbatim: real newlines, real double quotes, literal triple-backtick code fences, anything. Do not wrap the inner markdown in any fence or quote.

## Hard rules

${formatHardRules(ctx)}`;
}

/**
 * Build the annotator user prompt carrying the finalized article body and
 * the spec the annotator references.
 */
export function buildArticleAnnotatorUserPrompt(args: {
	spec: ArticleSpec;
	body: ArticleBody;
}): string {
	return `## Article spec

article_slug: ${args.spec.article_slug}
opportunity_signal: ${args.spec.opportunity_signal}
angle: ${args.spec.angle}
metaphor_family: ${args.spec.metaphor_family}
primary_medium_pub: ${args.spec.primary_medium_pub ?? 'none'}

## Finalized title

${args.body.title}

## Finalized subtitle

${args.body.subtitle}

## Finalized body

${args.body.content_md}

## Your task

Produce the three companion markdown files for this article. Quotes reference the body verbatim by placement anchor. Images use the metaphor family assigned above. Publications rank targets, set canonical_url instructions, and include the suggested submission sequence and the series-level publication conflict update. Return only the JSON object specified in your system instructions.`;
}

// ---------------------------------------------------------------------------
// Helpers exposed to the runner for series-state bookkeeping.
// ---------------------------------------------------------------------------

/**
 * Compute the next recentMetaphorFamilies array after adding one freshly-used
 * family. Keeps the most recent N families (default 3 to enforce the
 * "no more than once every three articles" rule from the spec).
 */
export function pushRecentMetaphorFamily(
	state: SeriesState,
	family: MetaphorFamily,
	keep = 3
): MetaphorFamily[] {
	const next = [family, ...state.recentMetaphorFamilies.filter((f) => f !== family)];
	return next.slice(0, keep);
}
