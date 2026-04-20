import "dotenv/config";
import { runAllPipelines } from "./runner.js";
import { sendReportEmail } from "./notify.js";
import { disconnectClient } from "@/lib/rocketride";
import { closeDriver } from "@/lib/db/neo4j";
import pool from "@/lib/db/postgres";

async function main() {
  try {
    const result = await runAllPipelines("manual");

    if (result.reportId) {
      await sendReportEmail(result.reportId);
    }
  } catch (err) {
    console.error("[Pipeline] Failed:", err);
    process.exit(1);
  } finally {
    await disconnectClient();
    await closeDriver();
    await pool.end();
  }
}

main();
