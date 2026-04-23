import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), "../../../.env") });

import { spawn } from "child_process";
import cron from "node-cron";
import { scrape } from "./index.js";
import { query, getClient as getPgClient } from "@pulsar/shared/db/postgres";
import { env } from "@pulsar/shared/config/env";

// Fixed advisory lock ID for the scheduler singleton
const SCHEDULER_LOCK_ID = 73952;

let scrapeRunning = false;
let pipelineRunning = false;

const RELOAD_INTERVAL_MS = 60_000;

interface ScheduleRow {
  type: string;
  hour: number;
  minute: number;
  days: number[];
  active: boolean;
}

type Task = ReturnType<typeof cron.schedule>;
const activeTasks: Task[] = [];

function toCron(hour: number, minute: number, days: number[]): string {
  const dayList = days.length === 7 ? "*" : days.join(",");
  return `${minute} ${hour} * * ${dayList}`;
}

async function loadSchedules(): Promise<ScheduleRow[]> {
  try {
    const result = await query<ScheduleRow>(
      "SELECT type, hour, minute, days, active FROM schedules WHERE active = true",
    );
    return result.rows;
  } catch {
    // Table may not exist yet — fall back to env
    return [];
  }
}

function clearTasks() {
  for (const task of activeTasks) task.stop();
  activeTasks.length = 0;
}

function triggerPipeline() {
  if (pipelineRunning) {
    console.log("[Scheduler] Pipeline skipped — previous run still in progress.");
    return;
  }
  pipelineRunning = true;
  console.log(`[Scheduler] Pipeline triggered at ${new Date().toISOString()}`);
  const child = spawn("pnpm", ["--filter", "@pulsar/pipeline", "run", "pipeline", "--", "--scheduled"], {
    stdio: "inherit",
    detached: false,
  });
  child.on("close", (code) => {
    pipelineRunning = false;
    if (code === 0) {
      console.log("[Scheduler] Pipeline complete.");
    } else {
      console.error(`[Scheduler] Pipeline exited with code ${code}`);
    }
  });
}

function registerScrape(cronExpr: string) {
  console.log(`[Scheduler] Scrape registered: ${cronExpr}`);
  const task = cron.schedule(cronExpr, async () => {
    if (scrapeRunning) {
      console.log("[Scheduler] Scrape skipped — previous run still in progress.");
      return;
    }
    scrapeRunning = true;
    console.log(`[Scheduler] Scrape triggered at ${new Date().toISOString()}`);
    try {
      await scrape(undefined, "scheduled");
      console.log("[Scheduler] Scrape complete.");
    } catch (err) {
      console.error("[Scheduler] Scrape failed:", err);
    } finally {
      scrapeRunning = false;
    }
  });
  activeTasks.push(task);
}

function registerPipeline(cronExpr: string) {
  console.log(`[Scheduler] Pipeline registered: ${cronExpr}`);
  const task = cron.schedule(cronExpr, () => triggerPipeline());
  activeTasks.push(task);
}

function scheduleFingerprint(schedules: ScheduleRow[]): string {
  return JSON.stringify(
    schedules.map((s) => `${s.type}:${s.hour}:${s.minute}:${s.days.join(",")}`)
      .sort(),
  );
}

function applySchedules(schedules: ScheduleRow[]) {
  clearTasks();

  const scrapeSchedules = schedules.filter((s) => s.type === "scrape");
  const pipelineSchedules = schedules.filter((s) => s.type === "pipeline");

  if (scrapeSchedules.length === 0) {
    console.log(`[Scheduler] No scrape schedules in DB, using env: ${env.scraper.cron}`);
    registerScrape(env.scraper.cron);
  } else {
    for (const s of scrapeSchedules) {
      registerScrape(toCron(s.hour, s.minute, s.days));
    }
  }

  for (const s of pipelineSchedules) {
    registerPipeline(toCron(s.hour, s.minute, s.days));
  }

  console.log(`[Scheduler] ${scrapeSchedules.length || 1} scrape + ${pipelineSchedules.length} pipeline schedule(s) active.`);
}

let lastFingerprint = "";

async function reloadIfChanged() {
  try {
    const schedules = await loadSchedules();
    const fp = scheduleFingerprint(schedules);
    if (fp !== lastFingerprint) {
      console.log("[Scheduler] Schedule change detected, reloading...");
      lastFingerprint = fp;
      applySchedules(schedules);
    }
  } catch (err) {
    console.error("[Scheduler] Failed to check for schedule changes:", err);
  }
}

async function main() {
  // Acquire advisory lock — ensures only one scheduler process runs at a time.
  // The lock is held for the lifetime of this connection (released on disconnect).
  const lockClient = await getPgClient();
  const lockResult = await lockClient.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS locked",
    [SCHEDULER_LOCK_ID],
  );
  if (!lockResult.rows[0].locked) {
    lockClient.release();
    console.error("[Scheduler] Another scheduler is already running. Exiting.");
    process.exit(1);
  }
  console.log("[Scheduler] Advisory lock acquired.");

  const schedules = await loadSchedules();
  lastFingerprint = scheduleFingerprint(schedules);
  applySchedules(schedules);

  setInterval(reloadIfChanged, RELOAD_INTERVAL_MS);
  console.log("[Scheduler] Started. Polling for schedule changes every 60s.");

  process.on("SIGINT", () => {
    console.log("\n[Scheduler] Shutting down...");
    clearTasks();
    lockClient.release();
    process.exit(0);
  });
}

main();
