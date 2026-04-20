"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

const TYPE_ICONS: Record<string, { icon: string; color: string }> = {
  pipeline: {
    icon: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    color: "text-violet-500",
  },
  report: {
    icon: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    color: "text-violet-500",
  },
  drafts: {
    icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
    color: "text-amber-500",
  },
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((data) => setNotifications(data.notifications));
  }, []);

  async function markAsRead(id: string) {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    window.dispatchEvent(new Event("notification-read"));
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Notifications</h1>
      <p className="mt-1 text-gray-500 dark:text-neutral-400">Pipeline reports and content generation alerts</p>

      <div className="mt-6 space-y-3">
        {notifications.length === 0 ? (
          <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-8 text-center text-gray-400 dark:text-neutral-500">
            No notifications yet. Notifications appear after pipeline runs complete.
          </div>
        ) : (
          notifications.map((n) => {
            const typeInfo = TYPE_ICONS[n.type] || { icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", color: "text-gray-400" };
            return (
              <div
                key={n.id}
                onClick={() => !n.read && markAsRead(n.id)}
                className={`rounded-lg border p-4 transition cursor-pointer ${
                  n.read
                    ? "border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                    : "border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 shadow-sm"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="relative mt-0.5 flex-shrink-0">
                    <svg className={`h-5 w-5 ${typeInfo.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={typeInfo.icon} />
                    </svg>
                    {!n.read && (
                      <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-indigo-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className={`text-sm font-semibold ${n.read ? "text-gray-700 dark:text-neutral-300" : "text-gray-900 dark:text-neutral-100"}`}>{n.title}</p>
                      <span className="flex-shrink-0 text-xs text-gray-400 dark:text-neutral-500">
                        {new Date(n.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className={`mt-1 text-sm ${n.read ? "text-gray-500 dark:text-neutral-500" : "text-gray-600 dark:text-neutral-400"}`}>{n.message}</p>
                    {n.link && (
                      <Link
                        href={n.link}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!n.read) markAsRead(n.id);
                        }}
                        className="mt-2 inline-block text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        View details
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
