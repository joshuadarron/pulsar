import type { SourceAdapter, ScrapedItem } from "./types";
import { arxivCategories } from "@pulsar/shared/config/sources";
import { env } from "@pulsar/shared/config/env";

export const arxiv: SourceAdapter = async () => {
  const max = env.scraper.maxItemsPerSource;
  const perCat = Math.ceil(max / arxivCategories.length);
  const items: ScrapedItem[] = [];

  for (const cat of arxivCategories) {
    try {
      const url = `https://export.arxiv.org/api/query?search_query=cat:${cat}&start=0&max_results=${perCat}&sortBy=submittedDate&sortOrder=descending`;
      const res = await fetch(url);
      if (!res.ok) continue;

      const text = await res.text();
      // Simple XML parsing for Atom feed entries
      const entries = text.split("<entry>").slice(1);

      for (const entry of entries) {
        const getTag = (tag: string) => {
          const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
          return match ? match[1].trim() : "";
        };

        const link = entry.match(/href="(https:\/\/arxiv\.org\/abs\/[^"]+)"/)?.[1] || "";
        const title = getTag("title").replace(/\s+/g, " ");
        const summary = getTag("summary").replace(/\s+/g, " ");
        const published = getTag("published");
        const authorName = getTag("name");

        if (link && title) {
          items.push({
            url: link,
            title,
            rawContent: summary || title,
            publishedAt: new Date(published),
            author: authorName,
            sourceName: `arXiv:${cat}`,
            sourcePlatform: "arxiv",
          });
        }
      }
    } catch (err) {
      console.warn(`Failed arXiv ${cat}:`, err);
    }
  }

  return items.slice(0, max);
};
