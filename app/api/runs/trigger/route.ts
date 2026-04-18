import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const type = body.type || "scrape";

  // Trigger is handled by spawning the process
  // In production this would use a job queue
  if (type === "scrape") {
    const { exec } = await import("child_process");
    exec("pnpm run scrape", (err, stdout, stderr) => {
      if (err) console.error("Manual scrape failed:", stderr);
      else console.log("Manual scrape output:", stdout);
    });
  } else if (type === "pipeline") {
    const { exec } = await import("child_process");
    exec("pnpm run pipeline-scheduler", (err, stdout, stderr) => {
      if (err) console.error("Manual pipeline failed:", stderr);
      else console.log("Manual pipeline output:", stdout);
    });
  }

  return NextResponse.json({ status: "triggered", type });
}
