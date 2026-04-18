import { notFound } from "next/navigation";
import { query } from "@/lib/db/postgres";
import ReportView from "@/components/report/ReportView";
import type { ReportData } from "@/types";

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

  return (
    <div>
      <div className="mb-6 no-print">
        <h1 className="text-2xl font-bold text-gray-900">Report Detail</h1>
      </div>
      <ReportView data={result.rows[0].report_data} reportId={id} />
    </div>
  );
}
