import "dotenv/config";
import { startPipelineScheduler } from "./scheduler.js";

startPipelineScheduler();

// Keep the process alive
process.on("SIGINT", () => {
  console.log("\n[Pipeline Scheduler] Shutting down...");
  process.exit(0);
});
