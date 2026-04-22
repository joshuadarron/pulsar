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

interface Schedule {
  id: string;
  type: "scrape" | "pipeline";
  hour: number;
  minute: number;
  days: number[];
  active: boolean;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];

export default function SettingsPage() {
  const { theme, toggle } = useTheme();
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [subError, setSubError] = useState("");
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  useEffect(() => {
    fetch("/api/subscribers").then((r) => r.json()).then((d) => setSubscribers(d.subscribers));
    fetchSchedules();
  }, []);

  function fetchSchedules() {
    fetch("/api/settings/schedule").then((r) => r.json()).then((d) => setSchedules(d.schedules));
  }

  async function addSchedule(type: "scrape" | "pipeline") {
    await fetch("/api/settings/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, hour: 6, minute: 0, days: WEEKDAYS }),
    });
    fetchSchedules();
  }

  async function updateSchedule(id: string, updates: Partial<Pick<Schedule, "hour" | "minute" | "days" | "active">>) {
    await fetch("/api/settings/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    setSchedules((prev) => prev.map((s) => s.id === id ? { ...s, ...updates } : s));
  }

  async function removeSchedule(id: string) {
    await fetch(`/api/settings/schedule?id=${id}`, { method: "DELETE" });
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  }

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

  const scrapeSchedules = schedules.filter((s) => s.type === "scrape");
  const pipelineSchedules = schedules.filter((s) => s.type === "pipeline");

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
        <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Manage who receives the intelligence report email</p>

        <div className="mt-4 max-w-3xl space-y-4">
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

      {/* Schedules */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100">Schedules</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Configure when scrapes and report pipelines run</p>

        <div className="mt-4 space-y-6 max-w-3xl">
          {/* Scrape Schedules */}
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-neutral-300">Scrape</h3>
              <button
                onClick={() => addSchedule("scrape")}
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                + Add schedule
              </button>
            </div>
            {scrapeSchedules.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400 dark:text-neutral-500">No scrape schedules configured.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {scrapeSchedules.map((s) => (
                  <ScheduleRow key={s.id} schedule={s} onUpdate={updateSchedule} onRemove={removeSchedule} />
                ))}
              </div>
            )}
          </div>

          {/* Pipeline Schedules */}
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-neutral-300">Report / Content</h3>
              <button
                onClick={() => addSchedule("pipeline")}
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                + Add schedule
              </button>
            </div>
            {pipelineSchedules.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400 dark:text-neutral-500">No pipeline schedules configured.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {pipelineSchedules.map((s) => (
                  <ScheduleRow key={s.id} schedule={s} onUpdate={updateSchedule} onRemove={removeSchedule} />
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400 dark:text-neutral-500">
            Changes take effect on the next scheduled cycle. Scrape collects data from all sources. Pipeline generates the trend report, content drafts, and sends the email notification.
          </p>
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
    </div>
  );
}

function ScheduleRow({
  schedule,
  onUpdate,
  onRemove,
}: {
  schedule: Schedule;
  onUpdate: (id: string, updates: Partial<Pick<Schedule, "hour" | "minute" | "days" | "active">>) => void;
  onRemove: (id: string) => void;
}) {
  const timeValue = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;

  function handleTimeChange(value: string) {
    const [h, m] = value.split(":").map(Number);
    onUpdate(schedule.id, { hour: h, minute: m });
  }

  function toggleDay(day: number) {
    const next = schedule.days.includes(day)
      ? schedule.days.filter((d) => d !== day)
      : [...schedule.days, day].sort();
    if (next.length === 0) return;
    onUpdate(schedule.id, { days: next });
  }

  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3 ${
      schedule.active
        ? "border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
        : "border-gray-100 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-950 opacity-60"
    }`}>
      <button
        onClick={() => onUpdate(schedule.id, { active: !schedule.active })}
        role="switch"
        aria-checked={schedule.active}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors ${
          schedule.active ? "bg-indigo-600" : "bg-gray-200 dark:bg-neutral-700"
        }`}
      >
        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          schedule.active ? "translate-x-4" : "translate-x-0.5"
        } mt-0.5`} />
      </button>

      <input
        type="time"
        value={timeValue}
        onChange={(e) => handleTimeChange(e.target.value)}
        className="rounded border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 py-1.5 text-sm text-gray-900 dark:text-neutral-100 focus:border-indigo-500 focus:outline-none"
      />

      <div className="flex gap-1">
        {DAY_LABELS.map((label, i) => (
          <button
            key={i}
            onClick={() => toggleDay(i)}
            className={`h-7 w-7 rounded text-xs font-medium transition ${
              schedule.days.includes(i)
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 dark:bg-neutral-800 text-gray-400 dark:text-neutral-500 hover:bg-gray-200 dark:hover:bg-neutral-700"
            }`}
          >
            {label.charAt(0)}
          </button>
        ))}
      </div>

      <button
        onClick={() => onRemove(schedule.id)}
        className="ml-auto flex-shrink-0 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
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
