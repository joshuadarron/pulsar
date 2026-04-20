import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/postgres";
import activeProcesses from "@/lib/active-processes";

export async function GET() {
  const result = await query<{ run_type: string; id: string }>(
    "SELECT run_type, id FROM runs WHERE status = 'running'",
  );
  const running: Record<string, string> = {};
  for (const row of result.rows) {
    running[row.run_type] = row.id;
  }
  return NextResponse.json({ running });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const type = body.type || "scrape";

  // Guard: check in-memory active processes
  if (activeProcesses.has(type)) {
    return NextResponse.json(
      { error: `A ${type} run is already in progress.`, running: true },
      { status: 409 },
    );
  }

  // Guard: check DB for running runs of this type
  const existing = await query<{ id: string }>(
    "SELECT id FROM runs WHERE run_type = $1 AND status = 'running' LIMIT 1",
    [type],
  );
  if (existing.rows.length > 0) {
    return NextResponse.json(
      { error: `A ${type} run is already in progress.`, running: true },
      { status: 409 },
    );
  }

  const { spawn } = await import("child_process");

  if (type === "scrape") {
    const child = spawn("pnpm", ["run", "scrape"], {
      cwd: process.cwd(),
      detached: true,
      stdio: "pipe",
    });
    child.stdout?.on("data", (d) => console.log(String(d)));
    child.stderr?.on("data", (d) => console.error(String(d)));
    child.on("close", () => activeProcesses.delete("scrape"));
    activeProcesses.set("scrape", child);
  } else if (type === "pipeline") {
    const child = spawn("pnpm", ["run", "pipeline"], {
      cwd: process.cwd(),
      detached: true,
      stdio: "pipe",
    });
    child.stdout?.on("data", (d) => console.log(String(d)));
    child.stderr?.on("data", (d) => console.error(String(d)));
    child.on("close", () => activeProcesses.delete("pipeline"));
    activeProcesses.set("pipeline", child);
  }

  return NextResponse.json({ status: "triggered", type });
}
