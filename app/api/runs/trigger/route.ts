import { NextRequest, NextResponse } from "next/server";
import activeProcesses from "@/lib/active-processes";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const type = body.type || "scrape";

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
