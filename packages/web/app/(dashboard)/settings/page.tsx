"use client";

import { useState, useEffect } from "react";
import { redditSubreddits, rssSources, substackPublications, mediumTags, arxivCategories, githubSearchQueries } from "@pulsar/shared/config/sources";
import { useTheme } from "@/components/ThemeProvider";

interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  created_at: string;
}

export default function SettingsPage() {
  const { theme, toggle } = useTheme();
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [subError, setSubError] = useState("");

  useEffect(() => {
    fetch("/api/subscribers").then((r) => r.json()).then((d) => setSubscribers(d.subscribers));
  }, []);

  async function addSubscriber() {
    setSubError("");
    const res = await fetch("/api/subscribers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail, name: newName }),
    });
    if (!res.ok) {
      const data = await res.json();
      setSubError(data.error || "Failed to add");
      return;
    }
    setNewEmail("");
    setNewName("");
    const refreshed = await fetch("/api/subscribers").then((r) => r.json());
    setSubscribers(refreshed.subscribers);
  }

  async function toggleSubscriber(id: string, active: boolean) {
    await fetch("/api/subscribers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active }),
    });
    setSubscribers((prev) => prev.map((s) => s.id === id ? { ...s, active } : s));
  }

  async function removeSubscriber(id: string) {
    await fetch(`/api/subscribers?id=${id}`, { method: "DELETE" });
    setSubscribers((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Settings</h1>
      <p className="mt-1 text-gray-500 dark:text-neutral-400">Configuration overview</p>

      {/* Appearance */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100">Appearance</h2>
        <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 lg:w-[calc(50%-0.5rem)]">
          <div className="flex items-center gap-3">
            {theme === "dark" ? (
              <svg className="h-5 w-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
              </svg>
            )}
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-neutral-100">Dark Mode</p>
              <p className="text-xs text-gray-500 dark:text-neutral-400">{theme === "dark" ? "Dark theme is active" : "Light theme is active"}</p>
            </div>
          </div>
          <button
            onClick={toggle}
            role="switch"
            aria-checked={theme === "dark"}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
              theme === "dark" ? "bg-indigo-600" : "bg-gray-200 dark:bg-neutral-700"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                theme === "dark" ? "translate-x-5" : "translate-x-0.5"
              } mt-0.5`}
            />
          </button>
        </div>
      </section>

      {/* Email Subscribers */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100">Report Subscribers</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Manage who receives the daily intelligence report email</p>

        <div className="mt-4 max-w-3xl space-y-4">
          {/* Add subscriber form */}
          <div className="flex gap-2">
            <input
              type="email"
              placeholder="Email address"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSubscriber()}
              className="flex-1 rounded-lg border border-gray-300 dark:border-neutral-600 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:bg-neutral-900 dark:text-neutral-100"
            />
            <input
              type="text"
              placeholder="Name (optional)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSubscriber()}
              className="w-40 rounded-lg border border-gray-300 dark:border-neutral-600 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:bg-neutral-900 dark:text-neutral-100"
            />
            <button
              onClick={addSubscriber}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Add
            </button>
          </div>
          {subError && <p className="text-sm text-red-600 dark:text-red-400">{subError}</p>}

          {/* Subscriber list */}
          {subscribers.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-neutral-500">No subscribers yet. Add an email to receive report notifications.</p>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 divide-y divide-gray-100 dark:divide-neutral-800">
              {subscribers.map((sub) => (
                <div key={sub.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => toggleSubscriber(sub.id, !sub.active)}
                      role="switch"
                      aria-checked={sub.active}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors ${
                        sub.active ? "bg-indigo-600" : "bg-gray-200 dark:bg-neutral-700"
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        sub.active ? "translate-x-4" : "translate-x-0.5"
                      } mt-0.5`} />
                    </button>
                    <div className="min-w-0">
                      <p className={`text-sm truncate ${sub.active ? "text-gray-900 dark:text-neutral-100" : "text-gray-400 dark:text-neutral-500 line-through"}`}>
                        {sub.email}
                      </p>
                      {sub.name && <p className="text-xs text-gray-400 dark:text-neutral-500">{sub.name}</p>}
                    </div>
                  </div>
                  <button
                    onClick={() => removeSubscriber(sub.id)}
                    className="flex-shrink-0 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Source Configuration */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100">Data Sources</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Configured in config/sources.ts</p>

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
        <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100">Schedules</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
          <table className="min-w-full">
            <thead className="bg-gray-50 dark:bg-neutral-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">Process</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">Schedule</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-neutral-700">
              <tr>
                <td className="px-4 py-3 text-sm font-medium">Scraper</td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-neutral-400">05:30 daily</td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-neutral-400">All sources</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium">AI Pipelines</td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-neutral-400">After scrape</td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-neutral-400">Report → Drafts → Email</td>
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
    <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-neutral-300">{title}</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="rounded bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 text-xs text-gray-600 dark:text-neutral-400">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
