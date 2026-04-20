"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Report {
  id: string;
  generated_at: string;
  article_count: number;
  executive_summary: string;
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [unreadRefs, setUnreadRefs] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/reports").then((r) => r.json()).then(setReports);
    fetch("/api/notifications?refs=true")
      .then((r) => r.json())
      .then((data) => setUnreadRefs(new Set(data.referenceIds)));
  }, []);

  async function markAsRead(refId: string) {
    await fetch(`/api/notifications/${refId}?by=ref`, { method: "PATCH" });
    setUnreadRefs((prev) => {
      const next = new Set(prev);
      next.delete(refId);
      return next;
    });
    window.dispatchEvent(new Event("notification-read"));
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Reports</h1>
      <p className="mt-1 text-gray-500 dark:text-neutral-400">AI-generated trend reports from your data</p>

      <div className="mt-6 space-y-4">
        {reports.length === 0 ? (
          <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-8 text-center text-gray-400 dark:text-neutral-500">
            No reports generated yet. Run the pipeline to generate your first report.
          </div>
        ) : (
          reports.map((report) => {
            const isNew = unreadRefs.has(report.id);
            return (
              <Link
                key={report.id}
                href={`/reports/${report.id}`}
                onClick={() => isNew && markAsRead(report.id)}
                className={`block rounded-lg border p-5 transition hover:shadow-sm ${
                  isNew
                    ? "border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 shadow-sm"
                    : "border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-indigo-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-neutral-100">
                        Report — {new Date(report.generated_at).toLocaleDateString()}
                      </p>
                      {isNew && (
                        <span className="inline-flex items-center rounded-full bg-indigo-100 dark:bg-indigo-900 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                          New
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400 line-clamp-2">
                      {report.executive_summary || "No summary"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-indigo-600">{report.article_count}</p>
                    <p className="text-xs text-gray-400 dark:text-neutral-500">articles</p>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
