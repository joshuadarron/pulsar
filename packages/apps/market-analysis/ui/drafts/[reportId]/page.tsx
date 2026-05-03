import Link from 'next/link';
import { notFound } from 'next/navigation';
import React from 'react';

import {
	fillPostSteps,
	fillTopicRefinementPrompt,
	fillVoiceTransferPrompt
} from '@pulsar/app-market-analysis/templates';
import { type OperatorContext, loadOperatorContext } from '@pulsar/context';
import { query } from '@pulsar/shared/db/postgres';
import type { ContentDraft, ContentFormat, ReportData } from '@pulsar/shared/types';
import { type VoiceContext, type VoiceFormat, loadVoiceContext } from '@pulsar/voice';

import ViewerTabs, { type PlatformTabContent } from './ViewerTabs';

export const dynamic = 'force-dynamic';

const VOICE_FORMATS: VoiceFormat[] = [
	'long-form',
	'linkedin',
	'reddit',
	'discord',
	'twitter',
	'other'
];

const MARKDOWN_PLATFORMS = new Set(['hashnode', 'medium', 'devto', 'linkedin']);

interface ReportRow {
	id: string;
	run_id: string;
	generated_at: Date;
	period_start: Date;
	period_end: Date;
	report_data: ReportData;
	article_count: number;
}

interface DraftRow {
	id: string;
	run_id: string;
	report_id: string;
	platform: string;
	content_type: string;
	body: string;
	status: 'draft' | 'approved' | 'exported';
	angle: string | null;
	opportunity_signal: string | null;
	metadata: Record<string, unknown> | null;
	title: string | null;
	format: string | null;
	target: string | null;
	why_now: string | null;
	created_at: Date;
	updated_at: Date;
}

function rowToDraft(row: DraftRow): ContentDraft {
	return {
		id: row.id,
		runId: row.run_id,
		reportId: row.report_id,
		platform: row.platform,
		contentType: row.content_type,
		body: row.body,
		status: row.status,
		angle: row.angle,
		opportunitySignal: row.opportunity_signal,
		metadata: row.metadata,
		title: row.title,
		format: row.format as ContentDraft['format'],
		target: row.target,
		whyNow: row.why_now,
		createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
		updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)
	};
}

async function loadReport(reportId: string): Promise<ReportRow | null> {
	const result = await query<ReportRow>(
		`SELECT id, run_id, generated_at, period_start, period_end, report_data, article_count
		FROM reports
		WHERE id = $1`,
		[reportId]
	);
	return result.rows[0] ?? null;
}

async function loadDrafts(reportId: string): Promise<ContentDraft[]> {
	const result = await query<DraftRow>(
		`SELECT id, run_id, report_id, platform, content_type, body, status,
			angle, opportunity_signal, metadata,
			title, format, target, why_now,
			created_at, updated_at
		FROM content_drafts
		WHERE report_id = $1
		ORDER BY title NULLS LAST, angle NULLS LAST, platform`,
		[reportId]
	);
	return result.rows.map(rowToDraft);
}

function escapeHtml(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Replace remaining `{{name}}` placeholders with styled inline editable hint
 * spans. The fill helpers from `@pulsar/app-market-analysis/templates` leave
 * these in when no source value is available, per the Phase 6 spec.
 */
function highlightPlaceholders(html: string): string {
	return html.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, name: string) => {
		const safe = escapeHtml(name);
		return `<span class="inline-block rounded bg-yellow-100 dark:bg-yellow-900/40 px-1.5 py-0.5 text-xs font-mono text-yellow-900 dark:text-yellow-200">{{${safe}}}</span>`;
	});
}

/**
 * Minimal markdown to HTML converter for the in-page draft preview. Handles
 * headings, bold, italics, inline code, links, fenced code blocks, ordered
 * and unordered lists, and paragraphs. Markdown source the operator copies
 * is the source of truth; visual fidelity here matters less than structure.
 */
function renderMarkdown(input: string): string {
	const lines = input.split(/\r?\n/);
	const out: string[] = [];
	let inCode = false;
	let codeBuffer: string[] = [];
	let listType: 'ul' | 'ol' | null = null;
	let paragraphBuffer: string[] = [];

	function flushParagraph() {
		if (paragraphBuffer.length === 0) return;
		const text = paragraphBuffer.join(' ');
		out.push(`<p>${renderInline(text)}</p>`);
		paragraphBuffer = [];
	}

	function flushList() {
		if (!listType) return;
		out.push(`</${listType}>`);
		listType = null;
	}

	function renderInline(text: string): string {
		let escaped = escapeHtml(text);
		// Inline code first to protect its contents from later regexes.
		escaped = escaped.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
		// Links: [label](url)
		escaped = escaped.replace(
			/\[([^\]]+)\]\(([^)]+)\)/g,
			(_m, label, href) =>
				`<a href="${href}" class="text-indigo-600 underline" rel="noreferrer noopener">${label}</a>`
		);
		// Bold (**text**)
		escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		// Italic (*text*)
		escaped = escaped.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
		return escaped;
	}

	for (const rawLine of lines) {
		const line = rawLine;
		const fence = line.match(/^```(\w*)\s*$/);
		if (fence) {
			if (inCode) {
				out.push(
					`<pre class="overflow-x-auto rounded bg-gray-100 dark:bg-neutral-900 p-3 text-xs font-mono"><code>${escapeHtml(
						codeBuffer.join('\n')
					)}</code></pre>`
				);
				codeBuffer = [];
				inCode = false;
			} else {
				flushParagraph();
				flushList();
				inCode = true;
			}
			continue;
		}
		if (inCode) {
			codeBuffer.push(line);
			continue;
		}
		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			flushParagraph();
			flushList();
			const level = heading[1].length;
			out.push(`<h${level} class="font-semibold mt-3">${renderInline(heading[2])}</h${level}>`);
			continue;
		}
		const ol = line.match(/^\s*\d+\.\s+(.*)$/);
		const ul = line.match(/^\s*[-*]\s+(.*)$/);
		if (ol) {
			flushParagraph();
			if (listType !== 'ol') {
				flushList();
				out.push('<ol class="list-decimal pl-6 space-y-1">');
				listType = 'ol';
			}
			out.push(`<li>${renderInline(ol[1])}</li>`);
			continue;
		}
		if (ul) {
			flushParagraph();
			if (listType !== 'ul') {
				flushList();
				out.push('<ul class="list-disc pl-6 space-y-1">');
				listType = 'ul';
			}
			out.push(`<li>${renderInline(ul[1])}</li>`);
			continue;
		}
		if (line.trim() === '') {
			flushParagraph();
			flushList();
			continue;
		}
		paragraphBuffer.push(line.trim());
	}

	if (inCode) {
		out.push(
			`<pre class="overflow-x-auto rounded bg-gray-100 dark:bg-neutral-900 p-3 text-xs font-mono"><code>${escapeHtml(
				codeBuffer.join('\n')
			)}</code></pre>`
		);
	}
	flushParagraph();
	flushList();

	return out.join('\n');
}

interface DraftGroup {
	key: string;
	angle: string | null;
	title: string | null;
	format: ContentFormat | null;
	signal: string | null;
	target: string | null;
	whyNow: string | null;
	drafts: ContentDraft[];
}

/**
 * Group drafts so each recommendation renders as one section. V2 rows carry a
 * `title` and key by `(angle, title)` so two recommendations sharing an angle
 * still split. V1 rows have `title === null` and fall back to angle-only
 * grouping, matching the legacy viewer.
 */
function groupByRecommendation(drafts: ContentDraft[]): DraftGroup[] {
	const groups = new Map<string, DraftGroup>();
	for (const draft of drafts) {
		const angleKey = draft.angle ?? '(no angle)';
		const titleKey = draft.title ?? '(no title)';
		const key = draft.title ? `t:${titleKey}|a:${angleKey}` : `a:${angleKey}`;
		const existing = groups.get(key);
		if (existing) {
			existing.drafts.push(draft);
			continue;
		}
		groups.set(key, {
			key,
			angle: draft.angle,
			title: draft.title,
			format: draft.format,
			signal: draft.opportunitySignal,
			target: draft.target,
			whyNow: draft.whyNow,
			drafts: [draft]
		});
	}
	return Array.from(groups.values());
}

const FORMAT_BADGE_CLASSES: Record<ContentFormat, string> = {
	'blog-post': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
	tutorial: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
	'social-thread': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
	'medium-piece': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
	'video-tutorial': 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
	'short-post': 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200'
};

const FORMAT_LABELS: Record<ContentFormat, string> = {
	'blog-post': 'Blog post',
	tutorial: 'Tutorial',
	'social-thread': 'Social thread',
	'medium-piece': 'Medium piece',
	'video-tutorial': 'Video tutorial',
	'short-post': 'Short post'
};

interface RecommendationHeaderProps {
	title: string;
	format: ContentFormat | null;
	signal: string | null;
	angle: string | null;
	target: string | null;
	whyNow: string | null;
}

function RecommendationHeader({
	title,
	format,
	signal,
	angle,
	target,
	whyNow
}: RecommendationHeaderProps) {
	const fields: { key: string; label: string; body: string }[] = [];
	if (signal) fields.push({ key: 'signal', label: 'Signal', body: signal });
	if (angle) fields.push({ key: 'angle', label: 'Angle', body: angle });
	if (target) fields.push({ key: 'target', label: 'Target', body: target });
	if (whyNow) fields.push({ key: 'whyNow', label: 'Why now', body: whyNow });

	const badgeClass = format ? FORMAT_BADGE_CLASSES[format] : null;
	const formatLabel = format ? FORMAT_LABELS[format] : null;

	return (
		<header className="mb-4">
			<div className="flex items-start justify-between gap-3">
				<h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100">{title}</h2>
				{format && badgeClass && formatLabel ? (
					<span
						className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${badgeClass}`}
						aria-label={`Format: ${formatLabel}`}
					>
						{format}
					</span>
				) : null}
			</div>
			{fields.length > 0 ? (
				<dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
					{fields.map((field) => (
						<React.Fragment key={field.key}>
							<dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400">
								{field.label}
							</dt>
							<dd className="text-sm text-gray-800 dark:text-neutral-200">{field.body}</dd>
						</React.Fragment>
					))}
				</dl>
			) : null}
		</header>
	);
}

function AngleHeader({ angle }: { angle: string | null }) {
	const text = angle ?? null;
	return (
		<header className="mb-4">
			<p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400">
				Angle
			</p>
			<h2 className="mt-1 text-lg font-semibold text-gray-900 dark:text-neutral-100">
				{text ?? 'Ungrouped drafts'}
			</h2>
		</header>
	);
}

function formatMetadataCaption(metadata: Record<string, unknown> | null): string | null {
	if (!metadata) return null;
	const parts: string[] = [];
	const tags = metadata.tags;
	if (Array.isArray(tags) && tags.length > 0) {
		parts.push(`tags: ${tags.join(', ')}`);
	}
	if (typeof metadata.canonical_url === 'string' && metadata.canonical_url.trim() !== '') {
		parts.push(`canonical: ${metadata.canonical_url}`);
	}
	if (typeof metadata.thread_count === 'number') {
		parts.push(`thread: ${metadata.thread_count}`);
	}
	return parts.length > 0 ? parts.join(' | ') : null;
}

function buildContentNode(draft: ContentDraft) {
	const caption = formatMetadataCaption(draft.metadata);
	const body = draft.body ?? '';
	const isMarkdown = MARKDOWN_PLATFORMS.has(draft.platform);
	const html = isMarkdown ? renderMarkdown(body) : null;

	return {
		caption,
		body,
		html,
		isMarkdown
	};
}

interface ContentBlockProps {
	body: string;
	html: string | null;
	isMarkdown: boolean;
	caption: string | null;
}

function ContentBlock({ body, html, isMarkdown, caption }: ContentBlockProps) {
	return (
		<div>
			{isMarkdown && html ? (
				<div
					className="text-sm text-gray-800 dark:text-neutral-200"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: HTML produced server-side by trusted markdown helper that escapes user input
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			) : (
				<pre className="whitespace-pre-wrap rounded bg-gray-50 dark:bg-neutral-950 p-3 text-xs font-mono text-gray-800 dark:text-neutral-200">
					{body}
				</pre>
			)}
			{caption ? (
				<p className="mt-3 text-xs text-gray-500 dark:text-neutral-400 font-mono">{caption}</p>
			) : null}
		</div>
	);
}

function buildPlatformTabContent(
	draft: ContentDraft,
	operator: OperatorContext,
	voice: VoiceContext,
	report: ReportData
): PlatformTabContent {
	const ctx = { draft, operator, voice, report };
	const { caption, body, html, isMarkdown } = buildContentNode(draft);
	const stepsRaw = fillPostSteps(ctx);
	const stepsHtml = highlightPlaceholders(renderMarkdown(stepsRaw));
	const voicePromptText = fillVoiceTransferPrompt(ctx);
	const topicPromptText = fillTopicRefinementPrompt(ctx);

	return {
		platform: draft.platform,
		contentNode: <ContentBlock body={body} html={html} isMarkdown={isMarkdown} caption={caption} />,
		stepsHtml,
		voicePromptText,
		topicPromptText
	};
}

export default async function DraftViewerPage({
	params
}: {
	params: Promise<{ reportId: string }>;
}) {
	const { reportId } = await params;
	const operator = loadOperatorContext();
	const voice = loadVoiceContext(VOICE_FORMATS);
	const [report, drafts] = await Promise.all([loadReport(reportId), loadDrafts(reportId)]);

	if (!report) notFound();

	if (drafts.length === 0) {
		return (
			<div>
				<Link href="/drafts" className="text-sm text-indigo-600 hover:text-indigo-700">
					Back to drafts
				</Link>
				<h1 className="mt-3 text-2xl font-bold text-gray-900 dark:text-neutral-100">
					Drafts for report
				</h1>
				<p className="mt-2 text-sm text-gray-500 dark:text-neutral-400">
					{new Date(report.generated_at).toLocaleString()}
				</p>
				<div className="mt-6 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
					<p className="text-sm text-gray-700 dark:text-neutral-300">
						No drafts were generated for this report. The drafter may have judged that no
						interpretations met the bar.
					</p>
				</div>
			</div>
		);
	}

	const groups = groupByRecommendation(drafts);

	return (
		<div>
			<Link href="/drafts" className="text-sm text-indigo-600 hover:text-indigo-700">
				Back to drafts
			</Link>
			<h1 className="mt-3 text-2xl font-bold text-gray-900 dark:text-neutral-100">
				Drafts for report
			</h1>
			<p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
				{new Date(report.generated_at).toLocaleString()}
			</p>

			<div className="mt-8 space-y-10">
				{groups.map((group) => {
					const platforms = group.drafts.map((draft) =>
						buildPlatformTabContent(draft, operator, voice, report.report_data)
					);
					return (
						<section
							key={group.key}
							className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-950 p-5"
						>
							{group.title ? (
								<RecommendationHeader
									title={group.title}
									format={group.format}
									signal={group.signal}
									angle={group.angle}
									target={group.target}
									whyNow={group.whyNow}
								/>
							) : (
								<AngleHeader angle={group.angle} />
							)}
							<ViewerTabs platforms={platforms} />
						</section>
					);
				})}
			</div>
		</div>
	);
}
