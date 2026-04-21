import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), "../../../.env") });

import { startPipelineScheduler } from "./scheduler.js";

startPipelineScheduler();

// Keep the process alive
process.on("SIGINT", () => {
  console.log("\n[Pipeline Scheduler] Shutting down...");
  process.exit(0);
});
