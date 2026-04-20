"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

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

const PAGE_SIZE = 20;

function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function LiveDuration({ startedAt, completedAt, status }: { startedAt: string; completedAt: string | null; status: string }) {
  const [display, setDisplay] = useState(() => formatDuration(startedAt, completedAt));

  useEffect(() => {
    if (status !== "running") {
      setDisplay(formatDuration(startedAt, completedAt));
      return;
    }
    const timer = setInterval(() => setDisplay(formatDuration(startedAt, null)), 1000);
    return () => clearInterval(timer);
  }, [startedAt, completedAt, status]);

  return (
    <span className="tabular-nums">
      {display}
      {status === "running" && <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />}
    </span>
  );
}

type SortKey = "run_type" | "trigger" | "started_at" | "completed_at" | "status" | "articles_scraped" | "articles_new";
type SortOrder = "asc" | "desc";

export default function RunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortKey>(() => {
    if (typeof window !== "undefined") return (localStorage.getItem("runs_sortBy") as SortKey) || "started_at";
    return "started_at";
  });
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    if (typeof window !== "undefined") return (localStorage.getItem("runs_sortOrder") as SortOrder) || "desc";
    return "desc";
  });
  const [triggering, setTriggering] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleSort(key: SortKey) {
    let newOrder: SortOrder = "desc";
    if (sortBy === key) {
      newOrder = sortOrder === "desc" ? "asc" : "desc";
      setSortOrder(newOrder);
    } else {
      setSortBy(key);
      setSortOrder(newOrder);
    }
    localStorage.setItem("runs_sortBy", key);
    localStorage.setItem("runs_sortOrder", newOrder);
    setPage(1);
  }

  const fetchRuns = useCallback(() => {
    fetch(`/api/runs?page=${page}&limit=${PAGE_SIZE}&sort=${sortBy}&order=${sortOrder}`)
      .then((r) => r.json())
      .then((data) => {
        setRuns(data.runs);
        setTotal(data.total);
      });
  }, [page, sortBy, sortOrder]);

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 3000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

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
        setMessage(`${type} triggered successfully.`);
        setPage(1);
        fetchRuns();
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Run History</h1>
          <p className="mt-1 text-gray-500 dark:text-neutral-400">All scrape and pipeline run logs</p>
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
      {message && <p className="mt-2 text-sm text-green-600 dark:text-green-400">{message}</p>}

      <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-neutral-700">
          <thead className="bg-gray-50 dark:bg-neutral-800">
            <tr>
              <SortHeader label="Type" sortKey="run_type" current={sortBy} order={sortOrder} onSort={handleSort} />
              <SortHeader label="Trigger" sortKey="trigger" current={sortBy} order={sortOrder} onSort={handleSort} />
              <SortHeader label="Started" sortKey="started_at" current={sortBy} order={sortOrder} onSort={handleSort} />
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">Duration</th>
              <SortHeader label="Status" sortKey="status" current={sortBy} order={sortOrder} onSort={handleSort} />
              <SortHeader label="Articles" sortKey="articles_scraped" current={sortBy} order={sortOrder} onSort={handleSort} />
              <SortHeader label="New" sortKey="articles_new" current={sortBy} order={sortOrder} onSort={handleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-neutral-700">
            {runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400 dark:text-neutral-500">No runs yet.</td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr
                  key={run.id}
                  onClick={() => router.push(`/runs/${run.id}`)}
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-neutral-800"
                >
                  <td className="px-4 py-3 text-sm">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      run.run_type === "scrape" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                    }`}>
                      {run.run_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-neutral-400 capitalize">{run.trigger}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-neutral-400">
                    {new Date(run.started_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-neutral-400">
                    <LiveDuration startedAt={run.started_at} completedAt={run.completed_at} status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      run.status === "complete" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                      run.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                      run.status === "cancelled" ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" :
                      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                    }`}>
                      {run.status === "running" && <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />}
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-neutral-400">{run.articles_scraped}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-neutral-400">{run.articles_new}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-neutral-400">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} runs
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-neutral-300 transition hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600 dark:text-neutral-400 tabular-nums">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-neutral-300 transition hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  current,
  order,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  order: SortOrder;
  onSort: (key: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200 transition"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <svg className={`h-3 w-3 transition ${active ? "opacity-100" : "opacity-0"}`} viewBox="0 0 12 12" fill="currentColor">
          {order === "desc" ? (
            <path d="M6 8L2 4h8L6 8z" />
          ) : (
            <path d="M6 4L2 8h8L6 4z" />
          )}
        </svg>
      </span>
    </th>
  );
}
