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

const POSITIVE_WORDS = new Set([
  "amazing", "awesome", "best", "better", "breakthrough", "cool", "elegant",
  "excellent", "exciting", "fast", "faster", "favorite", "finally", "free",
  "good", "great", "happy", "impressive", "improved", "incredible", "innovation",
  "innovative", "interesting", "launch", "launched", "love", "nice", "open-source",
  "powerful", "promising", "recommended", "release", "released", "robust",
  "simple", "solid", "stable", "success", "superb", "top", "useful", "win",
  "wonderful", "worth",
]);

const NEGATIVE_WORDS = new Set([
  "awful", "bad", "broken", "bug", "complicated", "crash", "critical",
  "dangerous", "dead", "deprecated", "difficult", "disappointing", "error",
  "exploit", "fail", "failed", "flaw", "hack", "hacked", "horrible", "incident",
  "insecure", "issue", "leak", "leaked", "malware", "mess", "missing",
  "nightmare", "outage", "painful", "problem", "ransomware", "regression",
  "risk", "scary", "slow", "terrible", "threat", "trouble", "ugly",
  "unstable", "vulnerability", "vulnerable", "warning", "worse", "worst",
]);

export function analyzeSentiment(text: string): "positive" | "negative" | "neutral" {
  const words = text.toLowerCase().split(/\s+/);
  let pos = 0;
  let neg = 0;
  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) pos++;
    if (NEGATIVE_WORDS.has(w)) neg++;
  }
  if (pos > neg && pos >= 2) return "positive";
  if (neg > pos && neg >= 2) return "negative";
  return "neutral";
}

const CONTENT_TYPE_BY_PLATFORM: Record<string, string> = {
  arxiv: "research",
  github: "release",
  hackernews: "discussion",
  reddit: "discussion",
};

const TITLE_PATTERNS: [RegExp, string][] = [
  [/\bhow to\b|\btutorial\b|\bguide\b|\bstep[- ]by[- ]step\b|\blearn\b/i, "tutorial"],
  [/\bopinion\b|\bi think\b|\bmy take\b|\brant\b|\bhot take\b/i, "opinion"],
  [/\brelease\b|\blaunched?\b|\bv\d+\.\d+|\bannouncing\b|\bnew version\b/i, "release"],
  [/\bresearch\b|\bpaper\b|\bstudy\b|\bfindings\b|\barxiv\b/i, "research"],
];

export function classifyContentType(title: string, sourcePlatform: string): string {
  // Platform-based default
  const platformDefault = CONTENT_TYPE_BY_PLATFORM[sourcePlatform];

  // Title pattern matching overrides
  for (const [pattern, type] of TITLE_PATTERNS) {
    if (pattern.test(title)) return type;
  }

  if (platformDefault) return platformDefault;

  // Blog platforms default to news
  return "news";
}

export function extractSummary(title: string, rawContent: string): string {
  // If rawContent is just the title or very short, use title
  if (!rawContent || rawContent.length < 20 || rawContent === title) {
    return title;
  }

  // Take first 2-3 sentences
  const sentences = rawContent
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?]+[.!?]+/g);

  if (!sentences || sentences.length === 0) {
    return rawContent.slice(0, 300).trim();
  }

  const summary = sentences.slice(0, 3).join("").trim();
  return summary.length > 500 ? summary.slice(0, 500).trim() + "..." : summary;
}
