import { query } from '@pulsar/shared/db/postgres';
import type { ValidationRun } from './validators.js';

export async function persistValidation(
	runId: string,
	pipelineName: string,
	validation: ValidationRun,
): Promise<string> {
	const result = await query<{ id: string }>(
		`INSERT INTO pipeline_validations (run_id, pipeline_name, passed, checks, error_summary)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		[runId, pipelineName, validation.passed, JSON.stringify(validation.checks), validation.error_summary],
	);
	return result.rows[0].id;
}
