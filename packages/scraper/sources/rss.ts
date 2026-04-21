import RSSParser from "rss-parser";
import type { SourceAdapter, ScrapedItem } from "./types";
import { rssSources, substackPublications } from "@pulsar/shared/config/sources";
import { env } from "@pulsar/shared/config/env";

const parser = new RSSParser();

export const rss: SourceAdapter = async () => {
  const max = env.scraper.maxItemsPerSource;
  const allFeeds = [
    ...rssSources.map((s) => ({ ...s, platform: "rss" as const })),
    ...substackPublications.map((s) => ({ ...s, platform: "substack" as const })),
  ];
  const perFeed = Math.ceil(max / allFeeds.length);
  const items: ScrapedItem[] = [];

  for (const source of allFeeds) {
    try {
      const feed = await parser.parseURL(source.url);

      for (const entry of feed.items.slice(0, perFeed)) {
        if (!entry.link) continue;
        items.push({
          url: entry.link,
          title: entry.title || "",
          rawContent: entry.contentSnippet || entry.title || "",
          publishedAt: new Date(entry.pubDate || Date.now()),
          author: entry.creator,
          sourceName: source.name,
          sourcePlatform: source.platform,
        });
      }
    } catch (err) {
      console.warn(`Failed RSS ${source.name}:`, err);
    }
  }

  return items.slice(0, max);
};
