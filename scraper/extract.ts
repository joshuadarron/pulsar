import { entityList, stopwords } from "@/config/sources";
import type { EntityMention } from "@/types";

export function extractKeywords(text: string, maxKeywords = 20): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords.has(w));

  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

export function extractEntities(text: string): EntityMention[] {
  const found: EntityMention[] = [];
  const lowerText = text.toLowerCase();

  for (const entity of entityList) {
    if (lowerText.includes(entity.name.toLowerCase())) {
      found.push({ name: entity.name, type: entity.type });
    }
  }

  return found;
}

export function categorizeSource(sourcePlatform: string): string {
  const categories: Record<string, string> = {
    hackernews: "community",
    reddit: "community",
    github: "code",
    arxiv: "research",
    hashnode: "blog",
    devto: "blog",
    medium: "blog",
    rss: "news",
    substack: "newsletter",
  };
  return categories[sourcePlatform] || "other";
}
