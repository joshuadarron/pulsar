"use client";

import { redditSubreddits, rssSources, substackPublications, mediumTags, arxivCategories, githubSearchQueries } from "@/config/sources";
import { useTheme } from "@/components/ThemeProvider";

export default function SettingsPage() {
  const { theme, toggle } = useTheme();

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
                <td className="px-4 py-3 text-sm font-medium">Scraper (run 1)</td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-neutral-400">00:00 daily</td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-neutral-400">All sources</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium">Scraper (run 2)</td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-neutral-400">12:00 daily</td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-neutral-400">All sources</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-sm font-medium">AI Pipelines</td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-neutral-400">04:00 daily</td>
                <td className="px-4 py-3 text-sm text-gray-500 dark:text-neutral-400">Summarize → Report → Drafts</td>
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
