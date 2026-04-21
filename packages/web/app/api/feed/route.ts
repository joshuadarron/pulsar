import { NextRequest, NextResponse } from "next/server";
import { query } from "@pulsar/shared/db/postgres";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const page = parseInt(searchParams.get("page") || "1");
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
  const offset = (page - 1) * limit;
  const source = searchParams.get("source");
  const sentiment = searchParams.get("sentiment");
  const contentType = searchParams.get("contentType");
  const search = searchParams.get("q");

  let sql = "SELECT * FROM articles";
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (source) {
    conditions.push(`source_platform = $${conditions.length + 1}`);
    values.push(source);
  }
  if (sentiment) {
    conditions.push(`sentiment = $${conditions.length + 1}`);
    values.push(sentiment);
  }
  if (contentType) {
    conditions.push(`content_type = $${conditions.length + 1}`);
    values.push(contentType);
  }
  if (search) {
    conditions.push(`(title ILIKE $${conditions.length + 1} OR summary ILIKE $${conditions.length + 1})`);
    values.push(`%${search}%`);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY published_at DESC NULLS LAST";
  sql += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  values.push(limit, offset);

  const [articles, countResult] = await Promise.all([
    query(sql, values),
    query(
      `SELECT count(*) FROM articles${conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : ""}`,
      values.slice(0, -2),
    ),
  ]);

  return NextResponse.json({
    articles: articles.rows,
    total: parseInt((countResult.rows[0] as { count: string }).count),
    page,
    limit,
  });
}
