"use client";

import { useState, useEffect } from "react";

interface Draft {
  id: string;
  platform: string;
  content_type: string;
  body: string;
  status: string;
  created_at: string;
}

const PLATFORMS = ["all", "hashnode", "medium", "devto", "hackernews", "linkedin", "twitter", "discord"];

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Draft | null>(null);

  useEffect(() => {
    const params = filter !== "all" ? `?platform=${filter}` : "";
    fetch(`/api/drafts${params}`)
      .then((r) => r.json())
      .then(setDrafts);
  }, [filter]);

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/drafts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status } : d)),
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Content Drafts</h1>
      <p className="mt-1 text-gray-500">AI-generated content ready for review</p>

      <div className="mt-4 flex gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p}
            onClick={() => setFilter(p)}
            className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${
              filter === p
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {drafts.length === 0 ? (
            <p className="text-gray-400">No drafts found.</p>
          ) : (
            drafts.map((draft) => (
              <button
                key={draft.id}
                onClick={() => setSelected(draft)}
                className={`w-full rounded-lg border p-4 text-left transition ${
                  selected?.id === draft.id
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize text-gray-900">
                    {draft.platform}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    draft.status === "approved" ? "bg-green-100 text-green-700" :
                    draft.status === "exported" ? "bg-blue-100 text-blue-700" :
                    "bg-yellow-100 text-yellow-700"
                  }`}>
                    {draft.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {draft.content_type} — {new Date(draft.created_at).toLocaleDateString()}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-gray-600">
                  {draft.body.slice(0, 120)}...
                </p>
              </button>
            ))
          )}
        </div>

        {selected && (
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold capitalize text-gray-900">
                {selected.platform} — {selected.content_type}
              </h3>
              <div className="flex gap-2">
                {selected.status === "draft" && (
                  <button
                    onClick={() => updateStatus(selected.id, "approved")}
                    className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                  >
                    Approve
                  </button>
                )}
                {selected.status === "approved" && (
                  <button
                    onClick={() => updateStatus(selected.id, "exported")}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    Mark Exported
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4 max-h-[60vh] overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
                {selected.body}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
