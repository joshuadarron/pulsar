import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), "../../../.env") });

import { runAllPipelines } from "./runner.js";
import { disconnectClient } from "./lib/rocketride.js";
import { closeDriver } from "@pulsar/shared/db/neo4j";
import pool from "@pulsar/shared/db/postgres";

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
