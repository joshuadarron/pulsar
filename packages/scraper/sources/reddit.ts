import type { SourceAdapter, ScrapedItem } from "./types";
import { redditSubreddits } from "@pulsar/shared/config/sources";
import { env } from "@pulsar/shared/config/env";

interface RedditPost {
  data: {
    title: string;
    url: string;
    permalink: string;
    selftext: string;
    author: string;
    score: number;
    num_comments: number;
    created_utc: number;
  };
}

export const reddit: SourceAdapter = async () => {
  const max = env.scraper.maxItemsPerSource;
  const perSub = Math.ceil(max / redditSubreddits.length);
  const items: ScrapedItem[] = [];

  for (const sub of redditSubreddits) {
    try {
      const url = `https://www.reddit.com/r/${sub}/hot.json?limit=${perSub}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "pulsar-scraper/0.1" },
      });
      if (!res.ok) continue;

      const data = (await res.json()) as {
        data: { children: RedditPost[] };
      };

      for (const post of data.data.children) {
        const d = post.data;
        const articleUrl = d.url.startsWith("/")
          ? `https://www.reddit.com${d.permalink}`
          : d.url;

        items.push({
          url: articleUrl,
          title: d.title,
          rawContent: d.selftext || d.title,
          publishedAt: new Date(d.created_utc * 1000),
          author: d.author,
          score: d.score,
          commentCount: d.num_comments,
          sourceName: `r/${sub}`,
          sourcePlatform: "reddit",
        });
      }
    } catch (err) {
      console.warn(`Failed to fetch r/${sub}:`, err);
    }
  }

  return items.slice(0, max);
};
