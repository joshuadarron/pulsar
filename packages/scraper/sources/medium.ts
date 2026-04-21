import RSSParser from "rss-parser";
import type { SourceAdapter, ScrapedItem } from "./types";
import { mediumTags } from "@pulsar/shared/config/sources";
import { env } from "@pulsar/shared/config/env";

const parser = new RSSParser();

export const medium: SourceAdapter = async () => {
  const max = env.scraper.maxItemsPerSource;
  const perTag = Math.ceil(max / mediumTags.length);
  const items: ScrapedItem[] = [];

  for (const tag of mediumTags) {
    try {
      const feed = await parser.parseURL(
        `https://medium.com/feed/tag/${tag}`,
      );

      for (const entry of feed.items.slice(0, perTag)) {
        if (!entry.link) continue;
        items.push({
          url: entry.link,
          title: entry.title || "",
          rawContent: entry.contentSnippet || entry.title || "",
          publishedAt: new Date(entry.pubDate || Date.now()),
          author: entry.creator,
          sourceName: `Medium/${tag}`,
          sourcePlatform: "medium",
        });
      }
    } catch (err) {
      console.warn(`Failed Medium tag ${tag}:`, err);
    }
  }

  return items.slice(0, max);
};
