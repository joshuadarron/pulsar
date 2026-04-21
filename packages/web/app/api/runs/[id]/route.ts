import { NextResponse } from "next/server";
import { query } from "@pulsar/shared/db/postgres";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [runRes, logsRes] = await Promise.all([
    query<{
      id: string;
      started_at: string;
      completed_at: string | null;
      status: string;
      trigger: string;
      run_type: string;
      articles_scraped: number;
      articles_new: number;
      error_log: string | null;
    }>("SELECT * FROM runs WHERE id = $1", [id]),
    query<{
      id: string;
      logged_at: string;
      level: string;
      stage: string;
      message: string;
    }>("SELECT id, logged_at, level, stage, message FROM run_logs WHERE run_id = $1 ORDER BY logged_at ASC", [id]),
  ]);

  if (runRes.rows.length === 0) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({
    run: runRes.rows[0],
    logs: logsRes.rows,
  });
}
