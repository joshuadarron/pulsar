import "dotenv/config";
import cron from "node-cron";
import { scrape } from "./index.js";
import { env } from "@/config/env";

console.log(`[Scraper Scheduler] Started. Cron 1: ${env.scraper.cron1}, Cron 2: ${env.scraper.cron2}`);

cron.schedule(env.scraper.cron1, async () => {
  console.log(`[Scraper Scheduler] Cron 1 triggered at ${new Date().toISOString()}`);
  try {
    await scrape(undefined, "scheduled");
  } catch (err) {
    console.error("[Scraper Scheduler] Cron 1 failed:", err);
  }
});

cron.schedule(env.scraper.cron2, async () => {
  console.log(`[Scraper Scheduler] Cron 2 triggered at ${new Date().toISOString()}`);
  try {
    await scrape(undefined, "scheduled");
  } catch (err) {
    console.error("[Scraper Scheduler] Cron 2 failed:", err);
  }
});

// Keep the process alive
process.on("SIGINT", () => {
  console.log("\n[Scraper Scheduler] Shutting down...");
  process.exit(0);
});
