import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '@pulsar/shared/db/postgres';
import { logRun } from '@pulsar/shared/run-logger';
import type { PredictionType, ReportData } from '@pulsar/shared/types';
import { extractJson } from '../parse-json.js';
import { getClient } from '../rocketride.js';

const PIPELINES_DIR = path.resolve(fileURLToPath(import.meta.url), '../../../pipelines');
const EXTRACTION_PIPE = path.join(PIPELINES_DIR, 'extraction.pipe');

const VALID_TYPES: PredictionType[] = ['emergence', 'cluster_growth', 'entity_importance', 'general'];

interface ExtractedPrediction {
	prediction_text: string;
	predicted_entities: string[];
	predicted_topics: string[];
	prediction_type: string;
}

interface ExtractionResponse {
	predictions: ExtractedPrediction[];
}

function normalizeType(t: string): PredictionType {
	return (VALID_TYPES as string[]).includes(t) ? (t as PredictionType) : 'general';
}

export async function extractPredictions(
	client: Awaited<ReturnType<typeof getClient>>,
	runId: string,
	reportId: string,
	reportData: ReportData,
): Promise<number> {
	try {
		await logRun(runId, 'info', 'extract-predictions', 'Extracting predictions from trend report...');

		const result = await client.use({ filepath: EXTRACTION_PIPE });
		const token = result.token;
		const response = await client.send(token, JSON.stringify({ report: reportData }), {}, 'application/json');
		await client.terminate(token);

		const raw = response?.answers?.[0];
		if (!raw) {
			await logRun(runId, 'warn', 'extract-predictions', 'Extraction returned no answer');
			return 0;
		}

		let envelope: ExtractionResponse;
		if (typeof raw === 'object' && !Array.isArray(raw)) {
			envelope = raw as unknown as ExtractionResponse;
		} else {
			const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
			envelope = extractJson<ExtractionResponse>(str);
		}

		const predictions = Array.isArray(envelope.predictions) ? envelope.predictions : [];
		let saved = 0;
		for (const p of predictions) {
			if (!p.prediction_text || typeof p.prediction_text !== 'string') continue;
			await query(
				`INSERT INTO report_predictions (report_id, prediction_text, predicted_entities, predicted_topics, prediction_type)
				 VALUES ($1, $2, $3, $4, $5)`,
				[
					reportId,
					p.prediction_text,
					Array.isArray(p.predicted_entities) ? p.predicted_entities : [],
					Array.isArray(p.predicted_topics) ? p.predicted_topics : [],
					normalizeType(p.prediction_type),
				],
			);
			saved++;
		}
		await logRun(runId, 'success', 'extract-predictions', `Extracted ${saved} predictions`);
		return saved;
	} catch (err) {
		await logRun(runId, 'warn', 'extract-predictions', `Extraction failed (soft fail): ${err}`);
		return 0;
	}
}
