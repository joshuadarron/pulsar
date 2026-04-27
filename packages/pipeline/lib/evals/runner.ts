import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '@pulsar/shared/db/postgres';
import { logRun } from '@pulsar/shared/run-logger';
import type { DraftEvalSummary, EvaluationSummary } from '@pulsar/shared/types';
import { extractJson } from '../parse-json.js';
import { getClient } from '../rocketride.js';
import { CONTENT_DRAFT_RUBRIC, TREND_REPORT_RUBRIC, type RubricDimension } from './rubrics.js';
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

interface EvaluationResponse {
	scores: ScoreEntry[];
}

async function callEvaluationPipe(
	client: Awaited<ReturnType<typeof getClient>>,
	payload: {
		target_type: 'trend_report' | 'content_draft';
		target_id: string | null;
		artifact: unknown;
		rubric: RubricDimension[];
	},
): Promise<EvaluationResponse | null> {
	try {
		const result = await client.use({ filepath: EVALUATION_PIPE });
		const token = result.token;
		const response = await client.send(token, JSON.stringify(payload), {}, 'application/json');
		await client.terminate(token);

		const raw = response?.answers?.[0];
		if (!raw) return null;
		if (typeof raw === 'object' && !Array.isArray(raw)) {
			return raw as unknown as EvaluationResponse;
		}
		const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
		return extractJson<EvaluationResponse>(str);
	} catch (err) {
		console.error('[evaluation.pipe] failed:', err);
		return null;
	}
}

async function persistScores(
	runId: string,
	targetType: 'trend_report' | 'content_draft',
	targetId: string | null,
	scores: ScoreEntry[],
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
				JUDGE_MODEL,
			],
		);
	}
}

async function persistSubCheckRows(
	runId: string,
	platform: string,
	checks: { check_name: string; passed: boolean; detail?: string }[],
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
				'deterministic',
			],
		);
	}
}

function summarizeReport(scores: ScoreEntry[]): EvaluationSummary['reportScore'] {
	const numeric = scores.filter((s) => typeof s.score === 'number') as Required<Pick<ScoreEntry, 'score' | 'dimension'>>[];
	const total = numeric.reduce((acc, s) => acc + s.score, 0);
	const max = numeric.length * 5;
	const lowest = numeric.length > 0
		? numeric.reduce((min, s) => (s.score < min.score ? s : min))
		: null;
	return {
		total,
		max,
		lowestDim: lowest ? { name: lowest.dimension, score: lowest.score } : null,
	};
}

export async function runEvaluations(
	client: Awaited<ReturnType<typeof getClient>>,
	runId: string,
	reportId: string,
): Promise<EvaluationSummary | null> {
	await logRun(runId, 'info', 'evaluations', 'Starting LLM evaluations (Haiku)...');

	const reportRow = await query<{ report_data: unknown }>(
		'SELECT report_data FROM reports WHERE id = $1',
		[reportId],
	);
	if (reportRow.rows.length === 0) {
		await logRun(runId, 'warn', 'evaluations', `Report ${reportId} not found, skipping`);
		return null;
	}
	const reportData = reportRow.rows[0].report_data;

	const draftRows = await query<{ platform: string; body: string }>(
		'SELECT platform, body FROM content_drafts WHERE run_id = $1',
		[runId],
	);
	const drafts: Record<string, string> = {};
	for (const r of draftRows.rows) drafts[r.platform] = r.body;

	// 1) Trend report (sequential, RocketRide runs one pipe at a time)
	const reportResp = await callEvaluationPipe(client, {
		target_type: 'trend_report',
		target_id: null,
		artifact: reportData,
		rubric: TREND_REPORT_RUBRIC,
	});

	let reportScores: ScoreEntry[] = [];
	if (reportResp?.scores && Array.isArray(reportResp.scores)) {
		reportScores = reportResp.scores;
		await persistScores(runId, 'trend_report', null, reportScores);
		await logRun(runId, 'info', 'evaluations', `Trend report graded: ${reportScores.length} dimensions`);
	} else {
		await logRun(runId, 'warn', 'evaluations', 'Trend report grading failed or returned no scores');
	}

	// 2) Content drafts (sequential, since RocketRide runs one pipe at a time)
	const draftSummaries: DraftEvalSummary[] = [];
	for (const [platform, body] of Object.entries(drafts)) {
		// LLM grading
		const draftResp = await callEvaluationPipe(client, {
			target_type: 'content_draft',
			target_id: platform,
			artifact: body,
			rubric: CONTENT_DRAFT_RUBRIC,
		});
		let llmScores: ScoreEntry[] = [];
		if (draftResp?.scores && Array.isArray(draftResp.scores)) {
			llmScores = draftResp.scores;
			await persistScores(runId, 'content_draft', platform, llmScores);
		} else {
			await logRun(runId, 'warn', 'evaluations', `Draft grading failed for ${platform}`);
		}

		// Deterministic sub-checks
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
			failedSubChecks,
		});
	}

	await logRun(runId, 'success', 'evaluations', `Evaluations complete: report + ${draftSummaries.length} drafts`);

	return {
		reportScore: summarizeReport(reportScores),
		draftScores: draftSummaries,
	};
}
