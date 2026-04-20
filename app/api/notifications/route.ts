import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/postgres";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const unreadOnly = url.searchParams.get("unread") === "true";
  const refs = url.searchParams.get("refs") === "true";

  // Return just unread reference_ids for highlighting
  if (refs) {
    const result = await query<{ reference_id: string }>(
      "SELECT DISTINCT reference_id FROM notifications WHERE read = false AND reference_id IS NOT NULL",
    );
    const countRes = await query<{ count: string }>(
      "SELECT count(*) FROM notifications WHERE read = false",
    );
    return NextResponse.json({
      referenceIds: result.rows.map((r) => r.reference_id),
      unreadCount: parseInt(countRes.rows[0].count),
    });
  }

  const where = unreadOnly ? "WHERE read = false" : "";
  const result = await query(
    `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT 50`,
  );

  const countRes = await query<{ count: string }>(
    "SELECT count(*) FROM notifications WHERE read = false",
  );

  return NextResponse.json({
    notifications: result.rows,
    unreadCount: parseInt(countRes.rows[0].count),
  });
}
