// ---------------------------------------------------------------------------
// Article-package orchestrator (three-pass).
//
// Pass 1 (`article-picker.pipe`): reads report + series state. Emits N
// article specs with opportunity_signal, angle, proposed title and subtitle,
// assigned metaphor family (respecting rotation), assigned primary Medium
// publication (respecting queue), and cross-reference candidates.
//
// Pass 2 (`article-writer.pipe`): one call per spec. Emits the finalized
// title, subtitle, and content_md body, grounded in the operator's
// long-form voice samples.
//
// Pass 3 (`article-annotator.pipe`): one call per spec, after pass 2.
// Emits quotes_md, images_md, publications_md grounded on the locked-in
// body. Pull quote placement and image section anchors reference the body
// verbatim, so writing it after the body is final preserves quality.
//
// Series state is loaded once at the start and saved once at the end, so a
// failed packager call does not dirty the rotation history. Persistence of
// each article happens after both pass 2 and pass 3 succeed for that spec.
//
// This module is dependency-injected so the flow can be tested without
// spinning up RocketRide or PostgreSQL.
// ---------------------------------------------------------------------------

import {
	type ArticleSpec,
	MEDIUM_PUBLICATIONS,
	METAPHOR_FAMILIES,
	type MediumPublication,
	type MetaphorFamily,
	type PublishedArticleRef,
	type SeriesState,
	buildArticleAnnotatorSystemPrompt,
	buildArticleAnnotatorUserPrompt,
	buildArticlePickerSystemPrompt,
	buildArticlePickerUserPrompt,
	buildArticleWriterSystemPrompt,
	buildArticleWriterUserPrompt,
	pushRecentMetaphorFamily
} from '@pulsar/app-market-analysis/prompts/articles';
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

export type ArticlePipelineName =
	| 'article-picker.pipe'
	| 'article-writer.pipe'
	| 'article-annotator.pipe';

export type PipelinePayload = {
	system: string;
	user: string;
};

export type InvokeArticlePipelineFn = (
	runId: string,
	pipeName: ArticlePipelineName,
	payload: PipelinePayload
) => Promise<unknown>;

export type ContentArticleRow = {
	runId: string;
	reportId: string;
	articleSlug: string;
	opportunitySignal: string;
	angle: string;
	title: string | null;
	subtitle: string | null;
	metaphorFamily: MetaphorFamily | null;
	primaryMediumPub: MediumPublication | null;
	contentMd: string;
	quotesMd: string;
	imagesMd: string;
	publicationsMd: string;
	crossRefs: string[];
};

export type InsertArticleFn = (row: ContentArticleRow) => Promise<void>;

export type LoadOperatorContextFn = () => OperatorContext;
export type LoadVoiceContextFn = (formats: VoiceFormat[]) => VoiceContext;
export type LoadSeriesStateFn = () => Promise<SeriesState>;
export type SaveSeriesStateFn = (state: SeriesState) => Promise<void>;

export interface OrchestrateArticlesDeps {
	loadOperator: LoadOperatorContextFn;
	loadVoice: LoadVoiceContextFn;
	loadSeriesState: LoadSeriesStateFn;
	saveSeriesState: SaveSeriesStateFn;
	invokePipeline: InvokeArticlePipelineFn;
	insertArticle: InsertArticleFn;
	log: LogFn;
	/** Date stamp used for Medium publication queue entries. Injectable for tests. */
	now?: () => Date;
}

export interface OrchestrateArticlesArgs {
	runId: string;
	reportId: string;
	reportData: ReportData;
}

export interface OrchestrateArticlesResult {
	articleCount: number;
	skipped: 'no-interpretations' | 'no-articles' | null;
}

const PICKER_PIPE: ArticlePipelineName = 'article-picker.pipe';
const WRITER_PIPE: ArticlePipelineName = 'article-writer.pipe';
const ANNOTATOR_PIPE: ArticlePipelineName = 'article-annotator.pipe';

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function isMetaphorFamily(value: unknown): value is MetaphorFamily {
	return typeof value === 'string' && (METAPHOR_FAMILIES as readonly string[]).includes(value);
}

function isMediumPublication(value: unknown): value is MediumPublication {
	return typeof value === 'string' && (MEDIUM_PUBLICATIONS as readonly string[]).includes(value);
}

interface RawPickerResponse {
	articles?: Array<{
		article_slug?: unknown;
		opportunity_signal?: unknown;
		angle?: unknown;
		proposed_title?: unknown;
		proposed_subtitle?: unknown;
		metaphor_family?: unknown;
		primary_medium_pub?: unknown;
		cross_ref_candidates?: unknown;
	}>;
}

function parseSpecs(raw: unknown): ArticleSpec[] {
	if (!raw || typeof raw !== 'object') return [];
	const data = raw as RawPickerResponse;
	if (!Array.isArray(data.articles)) return [];

	const out: ArticleSpec[] = [];
	for (const entry of data.articles) {
		if (!entry || typeof entry !== 'object') continue;
		const slug = typeof entry.article_slug === 'string' ? entry.article_slug.trim() : '';
		const signal =
			typeof entry.opportunity_signal === 'string' ? entry.opportunity_signal.trim() : '';
		const angle = typeof entry.angle === 'string' ? entry.angle.trim() : '';
		const proposedTitle =
			typeof entry.proposed_title === 'string' ? entry.proposed_title.trim() : '';
		const proposedSubtitle =
			typeof entry.proposed_subtitle === 'string' ? entry.proposed_subtitle.trim() : '';

		if (!slug || !signal || !angle || !proposedTitle || !proposedSubtitle) continue;
		if (!isMetaphorFamily(entry.metaphor_family)) continue;

		const primaryMediumPub = isMediumPublication(entry.primary_medium_pub)
			? entry.primary_medium_pub
			: null;

		const crossRefCandidates = Array.isArray(entry.cross_ref_candidates)
			? entry.cross_ref_candidates.filter((c): c is string => typeof c === 'string')
			: [];

		out.push({
			article_slug: slug,
			opportunity_signal: signal,
			angle,
			proposed_title: proposedTitle,
			proposed_subtitle: proposedSubtitle,
			metaphor_family: entry.metaphor_family,
			primary_medium_pub: primaryMediumPub,
			cross_ref_candidates: crossRefCandidates
		});
	}
	return out;
}

interface RawWriterResponse {
	title?: unknown;
	subtitle?: unknown;
	content_md?: unknown;
}

function parseWriterResponse(raw: unknown): {
	title: string;
	subtitle: string;
	content_md: string;
} | null {
	if (!raw || typeof raw !== 'object') return null;
	const data = raw as RawWriterResponse;
	const title = typeof data.title === 'string' ? data.title.trim() : '';
	const subtitle = typeof data.subtitle === 'string' ? data.subtitle.trim() : '';
	const content = typeof data.content_md === 'string' ? data.content_md : '';
	if (!title || !subtitle || content.trim().length === 0) return null;
	return { title, subtitle, content_md: content };
}

interface RawAnnotatorResponse {
	quotes_md?: unknown;
	images_md?: unknown;
	publications_md?: unknown;
}

type AnnotatorFieldKey = 'quotes_md' | 'images_md' | 'publications_md';

const ANNOTATOR_OPEN_TAGS: Record<AnnotatorFieldKey, RegExp> = {
	quotes_md: /<<<\s*QUOTES_MD\s*>>>/i,
	images_md: /<<<\s*IMAGES_MD\s*>>>/i,
	publications_md: /<<<\s*PUBLICATIONS_MD\s*>>>/i
};

// Strip any trailing END markers (or fragments of them) plus any orphan
// opening markers that fell into the same section.
const END_TAG_TRAILER_RE = /<<<\s*END_(?:QUOTES|IMAGES|PUBLICATIONS)_MD\s*>>>[\s\S]*$/i;

/**
 * Extract the three annotator sections using opening tags as boundaries.
 * Tolerates missing <<<END_*_MD>>> markers, which is the common failure mode
 * when the model runs out of output tokens during the final (publications)
 * section. The order of opening tags is fixed by the system prompt.
 *
 * Each section runs from its opening tag to whichever comes first: the next
 * opening tag, an explicit END marker, or end-of-string. We strip any END
 * marker (and anything after) from the captured slice so the returned
 * markdown is clean.
 */
function extractTaggedSections(raw: string): {
	quotes_md: string;
	images_md: string;
	publications_md: string;
} | null {
	const positions: Array<{ key: AnnotatorFieldKey; start: number; tagLen: number }> = [];
	for (const key of ['quotes_md', 'images_md', 'publications_md'] as AnnotatorFieldKey[]) {
		const match = raw.match(ANNOTATOR_OPEN_TAGS[key]);
		if (!match || match.index === undefined) return null;
		positions.push({ key, start: match.index, tagLen: match[0].length });
	}

	positions.sort((a, b) => a.start - b.start);
	const out: Partial<Record<AnnotatorFieldKey, string>> = {};
	for (let i = 0; i < positions.length; i += 1) {
		const current = positions[i];
		const next = positions[i + 1];
		const sliceStart = current.start + current.tagLen;
		const sliceEnd = next ? next.start : raw.length;
		const body = raw.slice(sliceStart, sliceEnd).replace(END_TAG_TRAILER_RE, '').trim();
		if (body.length === 0) return null;
		out[current.key] = body;
	}

	if (!out.quotes_md || !out.images_md || !out.publications_md) return null;
	return {
		quotes_md: out.quotes_md,
		images_md: out.images_md,
		publications_md: out.publications_md
	};
}

/**
 * Lenient JSON-field recovery for the case where the LLM emitted a JSON
 * object but the markdown values inside contain unescaped characters that
 * break a strict JSON.parse. Walks the string keyed on field names and reads
 * up to the next field-name boundary, then strips outer quotes and unescapes
 * common sequences. Brittle by design; only used as a last-ditch fallback
 * before we give up on the response.
 */
function lenientJsonFieldExtract(raw: string): {
	quotes_md: string;
	images_md: string;
	publications_md: string;
} | null {
	const fields: AnnotatorFieldKey[] = ['quotes_md', 'images_md', 'publications_md'];
	const out: Partial<Record<AnnotatorFieldKey, string>> = {};

	for (const field of fields) {
		const startRe = new RegExp(`"${field}"\\s*:\\s*"`);
		const startMatch = raw.match(startRe);
		if (!startMatch || startMatch.index === undefined) return null;
		const valueStart = startMatch.index + startMatch[0].length;

		// Find the boundary: next field key or end-of-object.
		const otherFields = fields.filter((f) => f !== field);
		const boundaryRe = new RegExp(
			`("\\s*,\\s*"(?:${otherFields.join('|')})"\\s*:|"\\s*\\}\\s*$)`,
			'g'
		);
		boundaryRe.lastIndex = valueStart;
		const boundaryMatch = boundaryRe.exec(raw);
		if (!boundaryMatch) return null;
		const valueEnd = boundaryMatch.index;

		const rawValue = raw.slice(valueStart, valueEnd);
		// Best-effort unescape of common sequences the LLM does get right.
		const unescaped = rawValue
			.replace(/\\n/g, '\n')
			.replace(/\\t/g, '\t')
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, '\\');
		out[field] = unescaped.trim();
	}

	if (!out.quotes_md || !out.images_md || !out.publications_md) return null;
	return {
		quotes_md: out.quotes_md,
		images_md: out.images_md,
		publications_md: out.publications_md
	};
}

/**
 * Parse the annotator response into the three companion-file bodies.
 *
 * Resilience order:
 *   1. Raw string with <<<QUOTES_MD>>>...<<<END_QUOTES_MD>>> tagged sections
 *      (the primary format; chosen because escaping multi-kilobyte markdown
 *      into JSON proved brittle).
 *   2. Object form (legacy JSON shape; works if the LLM ignores the new
 *      contract and RocketRide pre-parses its output).
 *   3. Lenient JSON-field extract from a string (the LLM emitted JSON but
 *      JSON.parse failed because of unescaped characters in markdown).
 */
function parseAnnotatorResponse(raw: unknown): {
	quotes_md: string;
	images_md: string;
	publications_md: string;
} | null {
	if (typeof raw === 'string') {
		const tagged = extractTaggedSections(raw);
		if (tagged) return tagged;

		// Fallback: maybe the LLM still emitted JSON. Try lenient recovery.
		const lenient = lenientJsonFieldExtract(raw);
		if (lenient) return lenient;

		return null;
	}

	if (raw && typeof raw === 'object') {
		const data = raw as RawAnnotatorResponse;
		const quotes = typeof data.quotes_md === 'string' ? data.quotes_md : '';
		const images = typeof data.images_md === 'string' ? data.images_md : '';
		const publications = typeof data.publications_md === 'string' ? data.publications_md : '';
		if (
			quotes.trim().length === 0 ||
			images.trim().length === 0 ||
			publications.trim().length === 0
		) {
			return null;
		}
		return {
			quotes_md: quotes,
			images_md: images,
			publications_md: publications
		};
	}

	return null;
}

/**
 * Best-effort diagnostic summary of a failed annotator response. Returned to
 * the orchestrator to include in the warn log so we can see what the LLM
 * actually emitted on failure, since we no longer hit the JSON-extract path
 * in the runner.
 */
function describeAnnotatorResponse(raw: unknown): string {
	if (typeof raw === 'string') {
		const head = raw.slice(0, 600);
		const tail = raw.length > 900 ? raw.slice(-300) : '';
		const preview = tail
			? `[string ${raw.length} chars] ${head}\n...[middle elided]...\n${tail}`
			: `[string ${raw.length} chars] ${raw}`;
		return preview;
	}
	if (raw && typeof raw === 'object') {
		const keys = Object.keys(raw as Record<string, unknown>).join(',');
		const json = JSON.stringify(raw).slice(0, 800);
		return `[object keys=${keys}] ${json}`;
	}
	return `[type=${typeof raw}] ${String(raw).slice(0, 200)}`;
}

// ---------------------------------------------------------------------------
// Series state helpers
// ---------------------------------------------------------------------------

function resolveCrossRefs(candidates: string[], state: SeriesState): PublishedArticleRef[] {
	if (candidates.length === 0) return [];
	const bySlug = new Map(state.publishedArticles.map((ref) => [ref.slug, ref]));
	const out: PublishedArticleRef[] = [];
	for (const slug of candidates) {
		const ref = bySlug.get(slug);
		if (ref) out.push(ref);
	}
	return out;
}

/**
 * Merge operator-curated past articles (from `.context/past-articles.md`)
 * into the series state at load time. Operator entries win on slug
 * conflict because they carry curated URLs and angles. The merge is
 * in-memory only - persistence excludes operator slugs so the DB row
 * stays the pipeline-generated history.
 */
function mergeOperatorPastArticles(
	state: SeriesState,
	pastArticles: PublishedArticleRef[]
): SeriesState {
	if (pastArticles.length === 0) return state;
	const operatorSlugs = new Set(pastArticles.map((p) => p.slug));
	const dbFiltered = state.publishedArticles.filter((p) => !operatorSlugs.has(p.slug));
	return {
		...state,
		publishedArticles: [...dbFiltered, ...pastArticles]
	};
}

function nextSeriesState(args: {
	prev: SeriesState;
	family: MetaphorFamily;
	primaryMediumPub: MediumPublication | null;
	publishedRef: PublishedArticleRef;
	now: Date;
}): SeriesState {
	const { prev, family, primaryMediumPub, publishedRef, now } = args;
	const nextRecent = pushRecentMetaphorFamily(prev, family);
	const isoDate = now.toISOString().slice(0, 10);
	const nextQueue = { ...prev.mediumPublicationQueue };
	if (primaryMediumPub) {
		nextQueue[primaryMediumPub] = isoDate;
	}
	const nextPublished = [
		...prev.publishedArticles.filter((ref) => ref.slug !== publishedRef.slug),
		publishedRef
	];
	return {
		recentMetaphorFamilies: nextRecent,
		mediumPublicationQueue: nextQueue,
		publishedArticles: nextPublished
	};
}

// ---------------------------------------------------------------------------
// Orchestration entry point
// ---------------------------------------------------------------------------

export async function orchestrateArticles(
	deps: OrchestrateArticlesDeps,
	args: OrchestrateArticlesArgs
): Promise<OrchestrateArticlesResult> {
	const { runId, reportId, reportData } = args;
	const {
		loadOperator,
		loadVoice,
		loadSeriesState,
		saveSeriesState,
		invokePipeline,
		insertArticle,
		log
	} = deps;
	const now = deps.now ?? (() => new Date());

	const interpretations = reportData.sections.signalInterpretation.interpretations ?? [];
	const narrative = reportData.sections.signalInterpretation.narrative ?? [];
	if (interpretations.length === 0 && narrative.length === 0) {
		await log(
			runId,
			'info',
			'articles',
			'No signal interpretation content to draft from. Skipping.'
		);
		return { articleCount: 0, skipped: 'no-interpretations' };
	}

	const operatorContext = loadOperator();
	const voice = loadVoice(['long-form']);
	const operatorPastArticles = operatorContext.pastArticles ?? [];
	const operatorSlugs = new Set(operatorPastArticles.map((p) => p.slug));
	let state = mergeOperatorPastArticles(await loadSeriesState(), operatorPastArticles);

	// --- Pass 1: picker ---
	await log(runId, 'info', 'articles', 'Pass 1: picking article specs...');

	const pickerSystem = buildArticlePickerSystemPrompt(operatorContext, voice, state);
	const pickerUser = buildArticlePickerUserPrompt({
		signalInterpretation: reportData.sections.signalInterpretation,
		executiveSummary: reportData.sections.executiveSummary.text,
		marketSnapshot: reportData.sections.marketSnapshot.text,
		developerSignals: reportData.sections.developerSignals.text
	});

	const pickerResponse = await invokePipeline(runId, PICKER_PIPE, {
		system: pickerSystem,
		user: pickerUser
	});
	const specs = parseSpecs(pickerResponse);

	if (specs.length === 0) {
		await log(runId, 'info', 'articles', 'Picker returned 0 article specs. Skipping.');
		return { articleCount: 0, skipped: 'no-articles' };
	}

	await log(runId, 'info', 'articles', `Picker returned ${specs.length} article spec(s).`);

	let articleCount = 0;
	for (const spec of specs) {
		const stageLabel = `articles:${spec.article_slug}`;
		const crossRefs = resolveCrossRefs(spec.cross_ref_candidates, state);

		// --- Pass 2: writer ---
		await log(runId, 'info', stageLabel, 'Pass 2: writing body...');
		const writerSystem = buildArticleWriterSystemPrompt(operatorContext, voice);
		const writerUser = buildArticleWriterUserPrompt({
			spec,
			reportContext: {
				executiveSummary: reportData.sections.executiveSummary.text,
				marketSnapshot: reportData.sections.marketSnapshot.text
			},
			crossRefs
		});
		const writerResponse = await invokePipeline(runId, WRITER_PIPE, {
			system: writerSystem,
			user: writerUser
		});
		const body = parseWriterResponse(writerResponse);
		if (!body) {
			await log(runId, 'warn', stageLabel, 'Writer returned no parseable body. Skipping spec.');
			continue;
		}

		// --- Pass 3: annotator ---
		await log(runId, 'info', stageLabel, 'Pass 3: producing companion files...');
		const annotatorSystem = buildArticleAnnotatorSystemPrompt(operatorContext, voice, state);
		const annotatorUser = buildArticleAnnotatorUserPrompt({ spec, body });
		const annotatorResponse = await invokePipeline(runId, ANNOTATOR_PIPE, {
			system: annotatorSystem,
			user: annotatorUser
		});
		const annotation = parseAnnotatorResponse(annotatorResponse);
		if (!annotation) {
			const preview = describeAnnotatorResponse(annotatorResponse);
			await log(
				runId,
				'warn',
				stageLabel,
				`Annotator returned no parseable companion files. Skipping spec. Raw: ${preview}`
			);
			continue;
		}

		await insertArticle({
			runId,
			reportId,
			articleSlug: spec.article_slug,
			opportunitySignal: spec.opportunity_signal,
			angle: spec.angle,
			title: body.title,
			subtitle: body.subtitle,
			metaphorFamily: spec.metaphor_family,
			primaryMediumPub: spec.primary_medium_pub,
			contentMd: body.content_md,
			quotesMd: annotation.quotes_md,
			imagesMd: annotation.images_md,
			publicationsMd: annotation.publications_md,
			crossRefs: spec.cross_ref_candidates
		});

		state = nextSeriesState({
			prev: state,
			family: spec.metaphor_family,
			primaryMediumPub: spec.primary_medium_pub,
			publishedRef: {
				slug: spec.article_slug,
				title: body.title,
				angle: spec.angle
			},
			now: now()
		});

		articleCount += 1;
		await log(
			runId,
			'success',
			stageLabel,
			`Persisted article ${spec.article_slug} (${spec.metaphor_family}).`
		);
	}

	if (articleCount > 0) {
		// Persist only the pipeline-generated subset of publishedArticles.
		// Operator-curated entries live in `.context/past-articles.md` and are
		// re-merged on the next run, so storing them in the DB would create
		// duplicate / drifting state.
		await saveSeriesState({
			...state,
			publishedArticles: state.publishedArticles.filter((p) => !operatorSlugs.has(p.slug))
		});
	}

	return { articleCount, skipped: null };
}
