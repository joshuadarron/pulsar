import { NextResponse } from "next/server";
import { query } from "@/lib/db/postgres";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (body.body !== undefined) {
    updates.push(`body = $${idx++}`);
    values.push(body.body);
  }
  if (body.status !== undefined) {
    updates.push(`status = $${idx++}`);
    values.push(body.status);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  updates.push(`updated_at = now()`);
  values.push(id);

  const result = await query(
    `UPDATE content_drafts SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
    values,
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(result.rows[0]);
}
