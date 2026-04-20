"use client";

import { useState, useEffect } from "react";

interface Article {
  id: string;
  url: string;
  title: string;
  summary: string;
  content_type: string;
  sentiment: string;
  source_name: string;
  source_platform: string;
  score: number;
  published_at: string;
  topic_tags: string[];
}

const SOURCES = ["all", "hackernews", "reddit", "github", "arxiv", "hashnode", "devto", "medium", "rss"];
const SENTIMENTS = ["all", "positive", "negative", "neutral"];

export default function FeedPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [source, setSource] = useState("all");
  const [sentiment, setSentiment] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (source !== "all") params.set("source", source);
    if (sentiment !== "all") params.set("sentiment", sentiment);
    if (search) params.set("q", search);

    fetch(`/api/feed?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setArticles(data.articles);
        setTotal(data.total);
      });
  }, [page, source, sentiment, search]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Article Feed</h1>
      <p className="mt-1 text-gray-500 dark:text-neutral-400">{total.toLocaleString()} articles collected</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search articles..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 dark:border-neutral-600 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:bg-neutral-900 dark:text-neutral-100"
        />

        <select
          value={source}
          onChange={(e) => { setSource(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 dark:border-neutral-600 px-3 py-2 text-sm dark:bg-neutral-900 dark:text-neutral-100"
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>{s === "all" ? "All Sources" : s}</option>
          ))}
        </select>

        <select
          value={sentiment}
          onChange={(e) => { setSentiment(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 dark:border-neutral-600 px-3 py-2 text-sm dark:bg-neutral-900 dark:text-neutral-100"
        >
          {SENTIMENTS.map((s) => (
            <option key={s} value={s}>{s === "all" ? "All Sentiments" : s}</option>
          ))}
        </select>
      </div>

      <div className="mt-6 space-y-3">
        {articles.map((article) => (
          <a
            key={article.id}
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 transition hover:border-indigo-300 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-100">{article.title}</h3>
                {article.summary && (
                  <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400 line-clamp-2">{article.summary}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 text-xs text-gray-600 dark:text-neutral-400">
                    {article.source_name}
                  </span>
                  {article.content_type && (
                    <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                      {article.content_type}
                    </span>
                  )}
                  {article.sentiment && (
                    <span className={`rounded px-2 py-0.5 text-xs ${
                      article.sentiment === "positive" ? "bg-green-50 text-green-600 dark:bg-green-900 dark:text-green-300" :
                      article.sentiment === "negative" ? "bg-red-50 text-red-600 dark:bg-red-900 dark:text-red-300" :
                      "bg-gray-50 text-gray-600 dark:bg-neutral-800 dark:text-neutral-400"
                    }`}>
                      {article.sentiment}
                    </span>
                  )}
                  {article.topic_tags?.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                {article.score != null && (
                  <span className="text-sm font-semibold text-gray-700 dark:text-neutral-300">{article.score}</span>
                )}
                <p className="text-xs text-gray-400 dark:text-neutral-500">
                  {article.published_at && new Date(article.published_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </a>
        ))}

        {articles.length === 0 && (
          <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-8 text-center text-gray-400 dark:text-neutral-500">
            No articles found. Run a scrape to populate the feed.
          </div>
        )}
      </div>

      {total > 20 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500 dark:text-neutral-400">
            Page {page} of {Math.ceil(total / 20)}
          </span>
          <button
            disabled={page * 20 >= total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
