import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), "../../../.env") });

import { spawn } from "child_process";
import cron from "node-cron";
import { scrape } from "./index.js";
import { env } from "@pulsar/shared/config/env";

let running = false;

console.log(`[Scheduler] Started. Scrape cron: ${env.scraper.cron}`);

cron.schedule(env.scraper.cron, async () => {
  if (running) {
    console.log("[Scheduler] Skipped — previous run still in progress.");
    return;
  }
  running = true;
  console.log(`[Scheduler] Scrape triggered at ${new Date().toISOString()}`);
  try {
    await scrape(undefined, "scheduled");
    console.log("[Scheduler] Scrape complete. Starting pipeline...");
    triggerPipeline();
  } catch (err) {
    console.error("[Scheduler] Scrape failed:", err);
  } finally {
    running = false;
  }
});

function triggerPipeline() {
  const child = spawn("pnpm", ["--filter", "@pulsar/pipeline", "run", "pipeline"], {
    stdio: "inherit",
    detached: false,
  });
  child.on("close", (code) => {
    if (code === 0) {
      console.log("[Scheduler] Pipeline complete.");
    } else {
      console.error(`[Scheduler] Pipeline exited with code ${code}`);
    }
  });
}

// Keep the process alive
process.on("SIGINT", () => {
  console.log("\n[Scheduler] Shutting down...");
  process.exit(0);
});
