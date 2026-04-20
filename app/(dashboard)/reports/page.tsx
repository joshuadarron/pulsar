import Link from "next/link";
import { query } from "@/lib/db/postgres";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const result = await query<{
    id: string;
    generated_at: string;
    article_count: number;
    report_data: { executiveSummary: string };
  }>("SELECT id, generated_at, article_count, report_data FROM reports ORDER BY generated_at DESC");

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Reports</h1>
      <p className="mt-1 text-gray-500 dark:text-neutral-400">AI-generated trend reports from your data</p>

      <div className="mt-6 space-y-4">
        {result.rows.length === 0 ? (
          <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-8 text-center text-gray-400 dark:text-neutral-500">
            No reports generated yet. Run the pipeline to generate your first report.
          </div>
        ) : (
          result.rows.map((report) => (
            <Link
              key={report.id}
              href={`/reports/${report.id}`}
              className="block rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 transition hover:border-indigo-300 hover:shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-neutral-100">
                    Report — {new Date(report.generated_at).toLocaleDateString()}
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400 line-clamp-2">
                    {report.report_data?.executiveSummary || "No summary"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-indigo-600">{report.article_count}</p>
                  <p className="text-xs text-gray-400 dark:text-neutral-500">articles</p>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
