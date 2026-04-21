import { query } from "./db/postgres";

export type LogLevel = "info" | "warn" | "error" | "success";

export async function logRun(
  runId: string,
  level: LogLevel,
  stage: string,
  message: string,
) {
  const prefix = level === "error" ? "[ERROR]" : level === "warn" ? "[WARN]" : "";
  console.log(`[Run ${runId}] [${stage}] ${prefix} ${message}`);
  await query(
    "INSERT INTO run_logs (run_id, level, stage, message) VALUES ($1, $2, $3, $4)",
    [runId, level, stage, message],
  );
}
