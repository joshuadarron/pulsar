import { env } from '@pulsar/shared/config/env';
import cron from 'node-cron';
import { disconnectClient } from './lib/rocketride.js';
import { sendReportEmail } from './notify.js';
import { runAllPipelines } from './runner.js';

let running = false;

export function startPipelineScheduler() {
	const schedule = env.scraper.cron;
	console.log(`[Pipeline Scheduler] Started. Cron: ${schedule}`);

	cron.schedule(schedule, async () => {
		if (running) {
			console.log('[Pipeline Scheduler] Skipped — previous run still in progress.');
			return;
		}
		running = true;
		console.log(`[Pipeline Scheduler] Triggered at ${new Date().toISOString()}`);

		try {
			const result = await runAllPipelines('scheduled');

			if (result.reportId) {
				await sendReportEmail(result.reportId);
			}
		} catch (err) {
			console.error('[Pipeline Scheduler] Failed:', err);
		} finally {
			running = false;
			await disconnectClient();
		}
	});
}
