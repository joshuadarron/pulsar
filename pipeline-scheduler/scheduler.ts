import cron from "node-cron";
import { runAllPipelines } from "./runner.js";
import { sendReportEmail } from "./notify.js";
import { disconnectClient } from "@/lib/rocketride";
import { env } from "@/config/env";

export function startPipelineScheduler() {
  console.log(`[Pipeline Scheduler] Started. Cron: ${env.pipeline.cron}`);

  cron.schedule(env.pipeline.cron, async () => {
    console.log(`[Pipeline Scheduler] Triggered at ${new Date().toISOString()}`);

    try {
      const result = await runAllPipelines("scheduled");

      if (result.reportId) {
        await sendReportEmail(result.reportId);
      }
    } catch (err) {
      console.error("[Pipeline Scheduler] Failed:", err);
    } finally {
      await disconnectClient();
    }
  });
}
