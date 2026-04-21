"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Toast {
  id: string;
  title: string;
  message: string;
  link: string | null;
}

export default function NotificationToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<Toast>).detail;
      setToasts((prev) => [...prev, detail]);
      // Auto-dismiss after 8 seconds
      setTimeout(() => dismiss(detail.id), 8000);
    }
    window.addEventListener("notification-toast", onToast);
    return () => window.removeEventListener("notification-toast", onToast);
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="animate-in slide-in-from-right rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 shadow-lg"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-neutral-100">{toast.title}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400 line-clamp-2">{toast.message}</p>
              {toast.link && (
                <Link
                  href={toast.link}
                  onClick={() => dismiss(toast.id)}
                  className="mt-2 inline-block text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  View details
                </Link>
              )}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
