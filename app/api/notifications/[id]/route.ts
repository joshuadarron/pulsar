import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/postgres";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = request.nextUrl;
  const byRef = url.searchParams.get("by") === "ref";

  if (byRef) {
    // Mark all notifications with this reference_id as read
    await query("UPDATE notifications SET read = true WHERE reference_id = $1 AND read = false", [id]);
  } else {
    await query("UPDATE notifications SET read = true WHERE id = $1", [id]);
  }

  return NextResponse.json({ status: "ok" });
}
