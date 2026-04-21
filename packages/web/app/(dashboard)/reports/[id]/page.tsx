import { notFound } from "next/navigation";
import { query } from "@pulsar/shared/db/postgres";
import ReportView from "@/components/report/ReportView";
import type { ReportData } from "@pulsar/shared/types";

export const dynamic = "force-dynamic";

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await query<{ report_data: ReportData }>(
    "SELECT report_data FROM reports WHERE id = $1",
    [id],
  );

  if (result.rows.length === 0) notFound();

  return <ReportView data={result.rows[0].report_data} reportId={id} />;
}
