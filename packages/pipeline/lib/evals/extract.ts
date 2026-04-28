import { query } from '@pulsar/shared/db/postgres';
import { logRun } from '@pulsar/shared/run-logger';
import type { PredictionType, ReportData } from '@pulsar/shared/types';

const VALID_TYPES: PredictionType[] = [
	'emergence',
	'cluster_growth',
	'entity_importance',
	'general'
];

function normalizeType(t: string): PredictionType {
	return (VALID_TYPES as string[]).includes(t) ? (t as PredictionType) : 'general';
}

export async function extractPredictions(
	runId: string,
	reportId: string,
	reportData: ReportData
): Promise<number> {
	try {
		const predictions = reportData.sections.executiveSummary.predictions ?? [];
		if (predictions.length === 0) {
			await logRun(runId, 'info', 'extract-predictions', 'No predictions emitted by trend-report.');
			return 0;
		}

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
					normalizeType(p.prediction_type)
				]
			);
			saved++;
		}
		await logRun(runId, 'success', 'extract-predictions', `Persisted ${saved} predictions`);
		return saved;
	} catch (err) {
		await logRun(runId, 'warn', 'extract-predictions', `Persist failed (soft fail): ${err}`);
		return 0;
	}
}
