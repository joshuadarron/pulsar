"use client";

import { useState } from "react";
import { redditSubreddits, rssSources, substackPublications, mediumTags, arxivCategories, githubSearchQueries } from "@/config/sources";

export default function SettingsPage() {
  const [triggering, setTriggering] = useState<string | null>(null);
  const [message, setMessage] = useState("");

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
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      <p className="mt-1 text-gray-500">Configuration and manual controls</p>

      {/* Manual Triggers */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">Manual Triggers</h2>
        <div className="mt-3 flex gap-3">
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
        {message && <p className="mt-2 text-sm text-green-600">{message}</p>}
      </section>

      {/* Source Configuration */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">Data Sources</h2>
        <p className="mt-1 text-sm text-gray-500">Configured in config/sources.ts</p>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SourceCard title="Reddit Subreddits" items={redditSubreddits.map((s) => `r/${s}`)} />
          <SourceCard title="GitHub Search Queries" items={githubSearchQueries} />
          <SourceCard title="ArXiv Categories" items={arxivCategories} />
          <SourceCard title="Medium Tags" items={mediumTags} />
          <SourceCard title="RSS Feeds" items={rssSources.map((s) => s.name)} />
          <SourceCard title="Substack Publications" items={substackPublications.map((s) => s.name)} />
        </div>
      </section>

      {/* Schedule Info */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">Schedules</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Process</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Schedule</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr>
                <td className="px-4 py-3 text-sm font-medium">Scraper (run 1)</td>
                <td className="px-4 py-3 text-sm text-gray-600">00:00 daily</td>
                <td className="px-4 py-3 text-sm text-gray-500">All sources</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium">Scraper (run 2)</td>
                <td className="px-4 py-3 text-sm text-gray-600">12:00 daily</td>
                <td className="px-4 py-3 text-sm text-gray-500">All sources</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium">AI Pipelines</td>
                <td className="px-4 py-3 text-sm text-gray-600">04:00 daily</td>
                <td className="px-4 py-3 text-sm text-gray-500">Summarize → Report → Drafts</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SourceCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
