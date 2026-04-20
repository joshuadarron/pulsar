"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

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

interface LogEntry {
  id: string;
  logged_at: string;
  level: string;
  stage: string;
  message: string;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const LEVEL_STYLES: Record<string, string> = {
  info: "text-blue-600 dark:text-blue-400",
  warn: "text-yellow-600 dark:text-yellow-400",
  error: "text-red-600 dark:text-red-400",
  success: "text-green-600 dark:text-green-400",
};

const STATUS_BADGE: Record<string, string> = {
  running: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  complete: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  cancelled: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
};

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [duration, setDuration] = useState("");
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Fetch run data and poll while running
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    async function fetchRun() {
      const res = await fetch(`/api/runs/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setRun(data.run);
      setLogs(data.logs);
      setLoading(false);

      // Stop polling once complete/failed
      if (data.run.status !== "running" && interval) {
        clearInterval(interval);
      }
    }

    fetchRun();
    interval = setInterval(fetchRun, 2000);

    return () => clearInterval(interval);
  }, [id]);

  // Live duration ticker
  useEffect(() => {
    if (!run) return;

    function tick() {
      setDuration(formatDuration(run!.started_at, run!.completed_at));
    }
    tick();

    if (run.status === "running") {
      const timer = setInterval(tick, 1000);
      return () => clearInterval(timer);
    }
  }, [run]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 dark:border-neutral-600 border-t-indigo-600" />
      </div>
    );
  }

  if (!run) {
    return <p className="py-20 text-center text-gray-400 dark:text-neutral-500">Run not found.</p>;
  }

  // Derive unique stages for the timeline
  const stages = [...new Map(logs.map((l) => [l.stage, l])).keys()];
  const stageStatus = (stage: string) => {
    const stageLogs = logs.filter((l) => l.stage === stage);
    if (stageLogs.some((l) => l.level === "error")) return "error";
    if (stageLogs.some((l) => l.level === "success")) return "success";
    return "running";
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-neutral-500">
        <Link href="/runs" className="hover:text-gray-600 dark:hover:text-neutral-300">Run History</Link>
        <span>/</span>
        <span className="text-gray-700 dark:text-neutral-300">{run.id.slice(0, 8)}</span>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">
            {run.run_type === "scrape" ? "Scrape" : "Pipeline"} Run
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
            Triggered {run.trigger} on {new Date(run.started_at).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {run.status === "running" && (
            <button
              onClick={async () => {
                setCancelling(true);
                await fetch(`/api/runs/${id}/cancel`, { method: "POST" });
                setCancelling(false);
              }}
              disabled={cancelling}
              className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {cancelling ? "Cancelling..." : "Cancel Run"}
            </button>
          )}
          <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${STATUS_BADGE[run.status] || ""}`}>
            {run.status === "running" && (
              <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
            )}
            {run.status}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Duration" value={duration} live={run.status === "running"} />
        <StatTile label="Status" value={run.status} />
        <StatTile label="Articles Scraped" value={String(run.articles_scraped)} />
        <StatTile label="New Articles" value={String(run.articles_new)} />
      </div>

      {/* Stage Timeline */}
      {stages.length > 0 && (
        <div className="mt-6 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold uppercase text-gray-500 dark:text-neutral-400">Stages</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {stages.map((stage) => {
              const s = stageStatus(stage);
              return (
                <span
                  key={stage}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                    s === "success" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                    s === "error" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    s === "success" ? "bg-green-500" :
                    s === "error" ? "bg-red-500" :
                    "bg-yellow-500 animate-pulse"
                  }`} />
                  {stage}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Logs */}
      <div className="mt-4 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase text-gray-500 dark:text-neutral-400">Logs</h2>
          {run.status === "running" && (
            <span className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
              Live
            </span>
          )}
        </div>
        <div className="mt-3 max-h-[600px] overflow-y-auto rounded-lg bg-gray-50 dark:bg-neutral-950 p-4 font-mono text-xs">
          {logs.length === 0 ? (
            <p className="text-gray-400 dark:text-neutral-500">No log entries yet.</p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex gap-3 py-0.5">
                <span className="flex-shrink-0 text-gray-400 dark:text-neutral-600">
                  {new Date(log.logged_at).toLocaleTimeString()}
                </span>
                <span className={`flex-shrink-0 w-14 text-right uppercase ${LEVEL_STYLES[log.level] || ""}`}>
                  {log.level}
                </span>
                <span className="flex-shrink-0 text-gray-500 dark:text-neutral-500 w-28 truncate">
                  [{log.stage}]
                </span>
                <span className="text-gray-800 dark:text-neutral-200">{log.message}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* Error Log */}
      {run.error_log && (
        <div className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-5">
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">Error Log</h2>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{run.error_log}</pre>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
      <p className="text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-neutral-100 tabular-nums">
        {value}
        {live && <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />}
      </p>
    </div>
  );
}
