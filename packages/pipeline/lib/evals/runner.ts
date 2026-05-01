import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@pulsar/shared/db/postgres';
import { logRun } from '@pulsar/shared/run-logger';
import type { DraftEvalSummary, EvaluationSummary } from '@pulsar/shared/types';
import { extractJson } from '../parse-json.js';
import { type getClient, terminatePipeline, usePipeline } from '../rocketride.js';
import { CONTENT_DRAFT_RUBRIC, type RubricDimension, TREND_REPORT_RUBRIC } from './rubrics.js';
import { runSubChecks } from './sub-checks.js';

export const JUDGE_MODEL = 'claude-haiku-4-5-20251001';
const PIPELINES_DIR = path.resolve(fileURLToPath(import.meta.url), '../../../pipelines');
const EVALUATION_PIPE = path.join(PIPELINES_DIR, 'evaluation.pipe');

interface ScoreEntry {
	dimension: string;
	score?: number;
	passed?: boolean;
	rationale?: string;
}

type TargetType = 'trend_report' | 'content_draft';

interface BatchItem {
	type: TargetType;
	id: string | null;
	artifact: unknown;
	rubric: RubricDimension[];
}

interface BatchResult {
	type: TargetType;
	id: string | null;
	scores: ScoreEntry[];
}

interface BatchEvaluationResponse {
	results: BatchResult[];
}

async function callEvaluationPipe(
	client: Awaited<ReturnType<typeof getClient>>,
	runId: string,
	items: BatchItem[]
): Promise<BatchEvaluationResponse | null> {
	try {
		const { token } = await usePipeline(client, runId, EVALUATION_PIPE);
		const response = await client.send(token, JSON.stringify({ items }), {}, 'application/json');
		await terminatePipeline(client, token);

		const raw = response?.answers?.[0];
		if (!raw) return null;
		if (typeof raw === 'object' && !Array.isArray(raw)) {
			return raw as unknown as BatchEvaluationResponse;
		}
		const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
		return extractJson<BatchEvaluationResponse>(str);
	} catch (err) {
		console.error('[evaluation.pipe] failed:', err);
		return null;
	}
}

async function persistScores(
	runId: string,
	targetType: TargetType,
	targetId: string | null,
	scores: ScoreEntry[]
): Promise<void> {
	for (const s of scores) {
		await query(
			`INSERT INTO evaluations (run_id, target_type, target_id, dimension, score, passed, rationale, judge_model)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				runId,
				targetType,
				targetId,
				s.dimension,
				typeof s.score === 'number' ? s.score : null,
				typeof s.passed === 'boolean' ? s.passed : null,
				s.rationale ?? null,
				JUDGE_MODEL
			]
		);
	}
}

async function persistSubCheckRows(
	runId: string,
	platform: string,
	checks: { check_name: string; passed: boolean; detail?: string }[]
): Promise<void> {
	for (const c of checks) {
		await query(
			`INSERT INTO evaluations (run_id, target_type, target_id, dimension, score, passed, rationale, judge_model)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				runId,
				'content_draft',
				platform,
				`subcheck_${c.check_name}`,
				null,
				c.passed,
				c.detail ?? null,
				'deterministic'
			]
		);
	}
}

function summarizeReport(scores: ScoreEntry[]): EvaluationSummary['reportScore'] {
	const numeric = scores.filter((s) => typeof s.score === 'number') as Required<
		Pick<ScoreEntry, 'score' | 'dimension'>
	>[];
	const total = numeric.reduce((acc, s) => acc + s.score, 0);
	const max = numeric.length * 5;
	const lowest =
		numeric.length > 0 ? numeric.reduce((min, s) => (s.score < min.score ? s : min)) : null;
	return {
		total,
		max,
		lowestDim: lowest ? { name: lowest.dimension, score: lowest.score } : null
	};
}

function pickResult(
	results: BatchResult[],
	type: TargetType,
	id: string | null
): BatchResult | undefined {
	return results.find((r) => r.type === type && (r.id ?? null) === id);
}

export async function runEvaluations(
	client: Awaited<ReturnType<typeof getClient>>,
	runId: string,
	reportId: string
): Promise<EvaluationSummary | null> {
	await logRun(runId, 'info', 'evaluations', 'Starting LLM evaluations (Haiku, batch)...');

	const reportRow = await query<{ report_data: unknown }>(
		'SELECT report_data FROM reports WHERE id = $1',
		[reportId]
	);
	if (reportRow.rows.length === 0) {
		await logRun(runId, 'warn', 'evaluations', `Report ${reportId} not found, skipping`);
		return null;
	}
	const reportData = reportRow.rows[0].report_data;

	const draftRows = await query<{ platform: string; body: string }>(
		'SELECT platform, body FROM content_drafts WHERE run_id = $1',
		[runId]
	);
	const drafts: Record<string, string> = {};
	for (const r of draftRows.rows) drafts[r.platform] = r.body;

	// Build batch payload: 1 trend report + N drafts
	const items: BatchItem[] = [
		{
			type: 'trend_report',
			id: null,
			artifact: reportData,
			rubric: TREND_REPORT_RUBRIC
		},
		...Object.entries(drafts).map(
			([platform, body]): BatchItem => ({
				type: 'content_draft',
				id: platform,
				artifact: body,
				rubric: CONTENT_DRAFT_RUBRIC
			})
		)
	];

	const batch = await callEvaluationPipe(client, runId, items);
	const results = batch?.results ?? [];

	if (results.length === 0) {
		await logRun(runId, 'warn', 'evaluations', 'Batch grading returned no results');
	}

	// Trend report scoring
	const reportResult = pickResult(results, 'trend_report', null);
	let reportScores: ScoreEntry[] = [];
	if (reportResult?.scores && Array.isArray(reportResult.scores)) {
		reportScores = reportResult.scores;
		await persistScores(runId, 'trend_report', null, reportScores);
		await logRun(
			runId,
			'info',
			'evaluations',
			`Trend report graded: ${reportScores.length} dimensions`
		);
	} else {
		await logRun(runId, 'warn', 'evaluations', 'Trend report grading missing from batch');
	}

	// Per-draft scoring + deterministic sub-checks
	const draftSummaries: DraftEvalSummary[] = [];
	for (const [platform, body] of Object.entries(drafts)) {
		const draftResult = pickResult(results, 'content_draft', platform);
		let llmScores: ScoreEntry[] = [];
		if (draftResult?.scores && Array.isArray(draftResult.scores)) {
			llmScores = draftResult.scores;
			await persistScores(runId, 'content_draft', platform, llmScores);
		} else {
			await logRun(runId, 'warn', 'evaluations', `Draft grading missing for ${platform}`);
		}

		const sub = runSubChecks(platform, body);
		await persistSubCheckRows(runId, platform, sub.checks);

		const llmTotal = llmScores
			.filter((s) => typeof s.score === 'number')
			.reduce((acc, s) => acc + (s.score as number), 0);
		const llmMax = CONTENT_DRAFT_RUBRIC.length * 5;
		const subPassed = sub.checks.filter((c) => c.passed).length;
		const failedSubChecks = sub.checks.filter((c) => !c.passed).map((c) => c.check_name);

		draftSummaries.push({
			platform,
			llmScore: llmTotal,
			llmMax,
			subChecksPassed: subPassed,
			subChecksTotal: sub.checks.length,
			failedSubChecks
		});
	}

	await logRun(
		runId,
		'success',
		'evaluations',
		`Evaluations complete: report + ${draftSummaries.length} drafts (1 LLM call)`
	);

	return {
		reportScore: summarizeReport(reportScores),
		draftScores: draftSummaries
	};
}
