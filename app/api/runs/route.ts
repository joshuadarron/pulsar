import { NextResponse } from "next/server";
import { query } from "@/lib/db/postgres";

export async function GET() {
  const result = await query(
    "SELECT * FROM runs ORDER BY started_at DESC LIMIT 50",
  );
  return NextResponse.json(result.rows);
}
