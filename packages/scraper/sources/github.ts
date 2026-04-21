import type { SourceAdapter, ScrapedItem } from "./types";
import { githubSearchQueries } from "@pulsar/shared/config/sources";
import { env } from "@pulsar/shared/config/env";

interface GHRepo {
  html_url: string;
  full_name: string;
  description: string;
  owner: { login: string };
  stargazers_count: number;
  pushed_at: string;
  language: string;
}

export const github: SourceAdapter = async () => {
  const max = env.scraper.maxItemsPerSource;
  const perQuery = Math.ceil(max / githubSearchQueries.length);
  const items: ScrapedItem[] = [];

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  for (const q of githubSearchQueries) {
    try {
      const query = q.includes("pushed:") ? q : `${q}+pushed:>${weekAgo}`;
      const url = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=${perQuery}`;
      const res = await fetch(url, {
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      if (!res.ok) continue;

      const data = (await res.json()) as { items: GHRepo[] };

      for (const repo of data.items) {
        items.push({
          url: repo.html_url,
          title: repo.full_name,
          rawContent: repo.description || repo.full_name,
          publishedAt: new Date(repo.pushed_at),
          author: repo.owner.login,
          score: repo.stargazers_count,
          sourceName: "GitHub",
          sourcePlatform: "github",
        });
      }
    } catch (err) {
      console.warn(`Failed GitHub query ${q}:`, err);
    }
  }

  return items.slice(0, max);
};
