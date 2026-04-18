import { query } from "@/lib/db/postgres";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [articlesRes, reportsRes, runsRes, draftsRes] = await Promise.all([
    query<{ count: string }>("SELECT count(*) FROM articles"),
    query<{ count: string }>("SELECT count(*) FROM reports"),
    query<{ id: string; started_at: string; status: string; run_type: string; articles_new: number }>(
      "SELECT id, started_at, status, run_type, articles_new FROM runs ORDER BY started_at DESC LIMIT 5",
    ),
    query<{ count: string }>("SELECT count(*) FROM content_drafts WHERE status = 'draft'"),
  ]);

  const totalArticles = parseInt(articlesRes.rows[0]?.count || "0");
  const totalReports = parseInt(reportsRes.rows[0]?.count || "0");
  const pendingDrafts = parseInt(draftsRes.rows[0]?.count || "0");
  const recentRuns = runsRes.rows;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-gray-500">Overview of your DevRel intelligence pipeline</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total Articles" value={totalArticles} />
        <StatCard label="Reports Generated" value={totalReports} />
        <StatCard label="Pending Drafts" value={pendingDrafts} />
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">Recent Runs</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Started</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">New Articles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {recentRuns.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-400">No runs yet. Run a scrape to get started.</td>
                </tr>
              ) : (
                recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        run.run_type === "scrape" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                      }`}>
                        {run.run_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(run.started_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        run.status === "complete" ? "bg-green-100 text-green-700" :
                        run.status === "failed" ? "bg-red-100 text-red-700" :
                        "bg-yellow-100 text-yellow-700"
                      }`}>
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{run.articles_new}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900">{value.toLocaleString()}</p>
    </div>
  );
}
