import { loadOperatorContext } from '@pulsar/context';
import { query } from '@pulsar/shared/db/postgres';
import type { ContentDraft, ContentFormat, ReportData } from '@pulsar/shared/types';
import { type VoiceFormat, loadVoiceContext } from '@pulsar/voice';
import {
	type Block,
	type ListItem,
	type TabPane,
	type Tone,
	type ViewModel,
	emptyState,
	heading,
	list,
	markdown,
	rawHtml,
	section,
	tabs,
	view
} from '@pulsar/view-model';
import {
	fillPostSteps,
	fillTopicRefinementPrompt,
	fillVoiceTransferPrompt
} from '../templates/index.js';

export const DRAFTS_VIEWER_VIEW_ID = 'market-analysis.drafts.viewer';

const VOICE_FORMATS: VoiceFormat[] = [
	'long-form',
	'linkedin',
	'reddit',
	'discord',
	'twitter',
	'other'
];

const FORMAT_TONE: Record<ContentFormat, Tone> = {
	'blog-post': 'info',
	tutorial: 'info',
	'social-thread': 'positive',
	'medium-piece': 'info',
	'video-tutorial': 'negative',
	'short-post': 'warn'
};

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
		'SELECT id, run_id, generated_at, period_start, period_end, report_data, article_count FROM reports WHERE id = $1',
		[reportId]
	);
	return result.rows[0] ?? null;
}

async function loadDrafts(reportId: string): Promise<ContentDraft[]> {
	const result = await query<DraftRow>(
		`SELECT id, run_id, report_id, platform, content_type, body, status, angle, opportunity_signal, metadata,
			title, format, target, why_now, created_at, updated_at
		 FROM content_drafts WHERE report_id = $1
		 ORDER BY title NULLS LAST, angle NULLS LAST, platform`,
		[reportId]
	);
	return result.rows.map(rowToDraft);
}

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

function escapeHtml(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function preBlock(body: string): Block {
	return rawHtml(
		`<pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#374151;overflow-x:auto;">${escapeHtml(body)}</pre>`
	);
}

function buildPlatformPane(
	draft: ContentDraft,
	operator: ReturnType<typeof loadOperatorContext>,
	voice: ReturnType<typeof loadVoiceContext>,
	report: ReportData
): Block[] {
	const ctx = { draft, operator, voice, report };
	const steps = fillPostSteps(ctx);
	const voicePrompt = fillVoiceTransferPrompt(ctx);
	const topicPrompt = fillTopicRefinementPrompt(ctx);

	const blocks: Block[] = [];
	blocks.push(section('Content', [markdown(draft.body)], { id: 'content' }));
	blocks.push(section('Steps', [markdown(steps)], { id: 'steps' }));
	blocks.push(section('Voice transfer prompt', [preBlock(voicePrompt)], { id: 'voice-prompt' }));
	blocks.push(section('Topic refinement prompt', [preBlock(topicPrompt)], { id: 'topic-prompt' }));
	return blocks;
}

function buildRecommendationPane(
	group: DraftGroup,
	operator: ReturnType<typeof loadOperatorContext>,
	voice: ReturnType<typeof loadVoiceContext>,
	report: ReportData
): Block[] {
	const blocks: Block[] = [];
	if (group.title) blocks.push(heading(2, group.title));
	else if (group.angle) blocks.push(heading(2, group.angle));

	const meta: ListItem[] = [];
	if (group.format) {
		meta.push({
			primary: 'Format',
			secondary: group.format,
			badge: { label: group.format, tone: FORMAT_TONE[group.format] ?? 'neutral' }
		});
	}
	if (group.signal) meta.push({ primary: 'Signal', secondary: group.signal });
	if (group.angle && group.title) meta.push({ primary: 'Angle', secondary: group.angle });
	if (group.target) meta.push({ primary: 'Target', secondary: group.target });
	if (group.whyNow) meta.push({ primary: 'Why now', secondary: group.whyNow });
	if (meta.length > 0) blocks.push(list(meta, 'plain'));

	if (group.drafts.length === 1) {
		const only = group.drafts[0];
		blocks.push(heading(3, only.platform));
		blocks.push(...buildPlatformPane(only, operator, voice, report));
		return blocks;
	}

	const platformTabs: TabPane[] = group.drafts.map((draft) => ({
		id: `${group.key}:${draft.platform}`,
		label: draft.platform,
		blocks: buildPlatformPane(draft, operator, voice, report)
	}));
	blocks.push(tabs(platformTabs, platformTabs[0]?.id));
	return blocks;
}

export async function buildDraftsViewerView(reportId: string): Promise<ViewModel | null> {
	const [report, drafts] = await Promise.all([loadReport(reportId), loadDrafts(reportId)]);
	if (!report) return null;

	const generatedAt =
		report.generated_at instanceof Date ? report.generated_at : new Date(report.generated_at);

	if (drafts.length === 0) {
		return view(
			DRAFTS_VIEWER_VIEW_ID,
			[
				emptyState(
					'No drafts for this report.',
					'The drafter may have judged that no interpretations met the bar.'
				)
			],
			{
				title: 'Drafts for report',
				meta: { reportId, generatedAt: generatedAt.toISOString() }
			}
		);
	}

	const operator = loadOperatorContext();
	const voice = loadVoiceContext(VOICE_FORMATS);

	const groups = groupByRecommendation(drafts);
	const recTabs: TabPane[] = groups.map((group, idx) => ({
		id: group.key,
		label: group.title?.trim() || group.angle?.trim() || `Group ${idx + 1}`,
		blocks: buildRecommendationPane(group, operator, voice, report.report_data)
	}));

	return view(
		DRAFTS_VIEWER_VIEW_ID,
		[
			section(undefined, [tabs(recTabs, recTabs[0]?.id)], {
				subtitle: generatedAt.toLocaleString()
			})
		],
		{
			title: 'Drafts for report',
			meta: { reportId, generatedAt: generatedAt.toISOString(), recommendationCount: groups.length }
		}
	);
}
