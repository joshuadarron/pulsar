import "dotenv/config";
import { runAllPipelines } from "./runner.js";
import { disconnectClient } from "@/lib/rocketride";
import { closeDriver } from "@/lib/db/neo4j";
import pool from "@/lib/db/postgres";

async function main() {
  try {
    await runAllPipelines("manual");
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
