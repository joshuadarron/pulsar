import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@pulsar/shared/db/postgres';
import { logRun } from '@pulsar/shared/run-logger';
import type { RetrospectiveOutcome } from '@pulsar/shared/types';
import { extractJson } from '../parse-json.js';
import { disconnectClient, getClient, terminatePipeline, usePipeline } from '../rocketride.js';
import { JUDGE_MODEL } from './runner.js';

const PIPELINES_DIR = path.resolve(fileURLToPath(import.meta.url), '../../../pipelines');
const RETROSPECTIVE_PIPE = path.join(PIPELINES_DIR, 'retrospective.pipe');

const VALID_OUTCOMES: RetrospectiveOutcome[] = [
	'confirmed',
	'partially_confirmed',
	'refuted',
	'inconclusive'
];

interface CandidatePrediction {
	prediction_id: string;
	prediction_text: string;
	predicted_entities: string[];
	predicted_topics: string[];
	prediction_type: string;
	report_generated_at: string;
}

interface GraderResponse {
	outcome: string;
	evidence_summary: string;
	evidence_data?: Record<string, unknown>;
}

function normalizeOutcome(value: string): RetrospectiveOutcome {
	return (VALID_OUTCOMES as string[]).includes(value)
		? (value as RetrospectiveOutcome)
		: 'inconclusive';
}

async function loadCandidates(): Promise<CandidatePrediction[]> {
	// Predictions whose source report is exactly 14 days old (by date) and
	// have no retrospective_grades row yet.
	const result = await query<CandidatePrediction>(
		`SELECT
			p.id AS prediction_id,
			p.prediction_text,
			COALESCE(p.predicted_entities, '{}') AS predicted_entities,
			COALESCE(p.predicted_topics, '{}') AS predicted_topics,
			p.prediction_type,
			r.generated_at AS report_generated_at
		 FROM report_predictions p
		 JOIN reports r ON r.id = p.report_id
		 LEFT JOIN retrospective_grades g ON g.prediction_id = p.id
		 WHERE g.id IS NULL
		   AND r.generated_at::date = (now() - interval '14 days')::date`
	);
	return result.rows;
}

async function gradePrediction(
	client: Awaited<ReturnType<typeof getClient>>,
	runId: string,
	candidate: CandidatePrediction
): Promise<boolean> {
	try {
		const startDate = candidate.report_generated_at;
		const endDate = new Date().toISOString();

		const payload = {
			prediction: {
				prediction_text: candidate.prediction_text,
				predicted_entities: candidate.predicted_entities,
				predicted_topics: candidate.predicted_topics,
				prediction_type: candidate.prediction_type,
				made_at: startDate
			},
			query_window: { start_date: startDate, end_date: endDate }
		};

		const { token } = await usePipeline(client, runId, RETROSPECTIVE_PIPE);
		const response = await client.send(token, JSON.stringify(payload), {}, 'application/json');
		await terminatePipeline(client, token);

		const raw = response?.answers?.[0];
		if (!raw) {
			await logRun(
				runId,
				'warn',
				'retrospective',
				`Grader returned no answer for ${candidate.prediction_id}`
			);
			return false;
		}

		let parsed: GraderResponse;
		if (typeof raw === 'object' && !Array.isArray(raw)) {
			parsed = raw as unknown as GraderResponse;
		} else {
			const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
			parsed = extractJson<GraderResponse>(str);
		}

		const outcome = normalizeOutcome(parsed.outcome);
		const evidenceSummary =
			typeof parsed.evidence_summary === 'string' && parsed.evidence_summary.length > 0
				? parsed.evidence_summary
				: 'no evidence summary returned';
		const evidenceData = parsed.evidence_data ?? null;

		await query(
			`INSERT INTO retrospective_grades (prediction_id, outcome, evidence_summary, judge_model, evidence_data)
			 VALUES ($1, $2, $3, $4, $5)`,
			[
				candidate.prediction_id,
				outcome,
				evidenceSummary,
				JUDGE_MODEL,
				evidenceData ? JSON.stringify(evidenceData) : null
			]
		);

		await logRun(runId, 'info', 'retrospective', `Graded ${candidate.prediction_id}: ${outcome}`);
		return true;
	} catch (err) {
		await logRun(
			runId,
			'warn',
			'retrospective',
			`Failed to grade ${candidate.prediction_id}: ${err}`
		);
		return false;
	}
}

export async function runRetrospectiveGrading(
	trigger: 'scheduled' | 'manual' = 'scheduled'
): Promise<{ runId: string | null; graded: number; skipped: number }> {
	let runId: string;
	try {
		const runResult = await query<{ id: string }>(
			"INSERT INTO runs (trigger, run_type) VALUES ($1, 'retrospective') RETURNING id",
			[trigger]
		);
		runId = runResult.rows[0].id;
	} catch (err: unknown) {
		if (
			err &&
			typeof err === 'object' &&
			'code' in err &&
			(err as { code: string }).code === '23505'
		) {
			console.log('[Retrospective] Skipped, another retrospective run is active.');
			return { runId: null, graded: 0, skipped: 0 };
		}
		throw err;
	}

	let graded = 0;
	let skipped = 0;
	try {
		await logRun(runId, 'info', 'retrospective', `Retrospective run started (trigger: ${trigger})`);
		const candidates = await loadCandidates();
		await logRun(
			runId,
			'info',
			'retrospective',
			`Found ${candidates.length} candidate prediction(s) to grade`
		);

		if (candidates.length === 0) {
			await query("UPDATE runs SET completed_at = now(), status = 'complete' WHERE id = $1", [
				runId
			]);
			await logRun(runId, 'success', 'retrospective', 'No candidates, run complete');
			return { runId, graded: 0, skipped: 0 };
		}

		const client = await getClient();
		try {
			for (const c of candidates) {
				const ok = await gradePrediction(client, runId, c);
				if (ok) graded++;
				else skipped++;
			}
		} finally {
			await disconnectClient();
		}

		await query("UPDATE runs SET completed_at = now(), status = 'complete' WHERE id = $1", [runId]);
		await logRun(runId, 'success', 'retrospective', `Graded: ${graded}, skipped: ${skipped}`);
		return { runId, graded, skipped };
	} catch (err) {
		const message = String(err);
		await logRun(runId, 'error', 'retrospective', `Retrospective run failed: ${message}`);
		await query(
			"UPDATE runs SET completed_at = now(), status = 'failed', error_log = $1 WHERE id = $2",
			[message, runId]
		);
		throw err;
	}
}
