import { NextRequest, NextResponse } from "next/server";
import { query } from "@pulsar/shared/db/postgres";

export async function GET() {
  const result = await query<{ id: string; email: string; name: string | null; active: boolean; created_at: string }>(
    "SELECT id, email, name, active, created_at FROM subscribers ORDER BY created_at DESC",
  );
  return NextResponse.json({ subscribers: result.rows });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, name } = body;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  try {
    const result = await query<{ id: string }>(
      "INSERT INTO subscribers (email, name) VALUES ($1, $2) RETURNING id",
      [email.trim().toLowerCase(), name?.trim() || null],
    );
    return NextResponse.json({ id: result.rows[0].id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("unique") || message.includes("duplicate")) {
      return NextResponse.json({ error: "Email already subscribed" }, { status: 409 });
    }
    throw err;
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, active } = body;

  if (!id || typeof active !== "boolean") {
    return NextResponse.json({ error: "id and active required" }, { status: 400 });
  }

  await query("UPDATE subscribers SET active = $1 WHERE id = $2", [active, id]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await query("DELETE FROM subscribers WHERE id = $1", [id]);
  return NextResponse.json({ ok: true });
}
