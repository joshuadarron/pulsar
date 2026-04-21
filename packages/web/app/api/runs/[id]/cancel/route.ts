import { NextResponse } from "next/server";
import { query } from "@pulsar/shared/db/postgres";
import { logRun } from "@pulsar/shared/run-logger";
import activeProcesses from "@/lib/active-processes";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Check the run exists and is running
  const runRes = await query<{ status: string; run_type: string }>(
    "SELECT status, run_type FROM runs WHERE id = $1",
    [id],
  );

  if (runRes.rows.length === 0) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (runRes.rows[0].status !== "running") {
    return NextResponse.json({ error: "Run is not running" }, { status: 400 });
  }

  const runType = runRes.rows[0].run_type;

  // Kill the child process if it exists
  const child = activeProcesses.get(runType);
  if (child && child.pid) {
    try {
      // Kill the entire process tree (pnpm -> tsx -> node)
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // process may have already exited
      }
    }
    activeProcesses.delete(runType);
  }

  // Mark the run as cancelled
  await logRun(id, "warn", "cancel", "Run cancelled by user");
  await query(
    "UPDATE runs SET completed_at = now(), status = 'cancelled', error_log = COALESCE(error_log, '') || $1 WHERE id = $2",
    ["\nCancelled by user", id],
  );

  return NextResponse.json({ status: "cancelled", id });
}
