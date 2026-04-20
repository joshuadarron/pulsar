"use client";

import { useState, useEffect } from "react";

interface Run {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  trigger: string;
  run_type: string;
  articles_scraped: number;
  articles_new: number;
  error_log: string | null;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then(setRuns);
  }, []);

  async function trigger(type: "scrape" | "pipeline") {
    setTriggering(type);
    setMessage("");
    try {
      const res = await fetch("/api/runs/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (res.ok) {
        setMessage(`${type} triggered successfully. Check run history for progress.`);
        // Refresh the runs list
        const updated = await fetch("/api/runs").then((r) => r.json());
        setRuns(updated);
      } else {
        setMessage(`Failed to trigger ${type}.`);
      }
    } catch {
      setMessage(`Error triggering ${type}.`);
    } finally {
      setTriggering(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Run History</h1>
          <p className="mt-1 text-gray-500">All scrape and pipeline run logs</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => trigger("scrape")}
            disabled={triggering !== null}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {triggering === "scrape" ? "Running..." : "Run Scrape Now"}
          </button>
          <button
            onClick={() => trigger("pipeline")}
            disabled={triggering !== null}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {triggering === "pipeline" ? "Running..." : "Run Pipeline Now"}
          </button>
        </div>
      </div>
      {message && <p className="mt-2 text-sm text-green-600">{message}</p>}

      <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Trigger</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Started</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Articles</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">New</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">No runs yet.</td>
              </tr>
            ) : (
              runs.map((run) => {
                const duration = run.completed_at
                  ? `${((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(0)}s`
                  : "—";

                return (
                  <tr
                    key={run.id}
                    onClick={() => setSelectedRun(run)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        run.run_type === "scrape" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                      }`}>
                        {run.run_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 capitalize">{run.trigger}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(run.started_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{duration}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        run.status === "complete" ? "bg-green-100 text-green-700" :
                        run.status === "failed" ? "bg-red-100 text-red-700" :
                        "bg-yellow-100 text-yellow-700"
                      }`}>
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{run.articles_scraped}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{run.articles_new}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedRun?.error_log && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <h3 className="text-sm font-semibold text-red-700">Error Log</h3>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-red-600">{selectedRun.error_log}</pre>
        </div>
      )}
    </div>
  );
}
