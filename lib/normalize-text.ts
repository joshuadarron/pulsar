/**
 * Normalize text before sending to the LLM to reduce token count.
 * Lowercases, strips unnecessary punctuation, collapses whitespace.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")        // remove URLs
    .replace(/["""''`]/g, "")               // remove quotes
    .replace(/[#*_~^\\|<>{}[\]]/g, "")      // remove markdown/special chars
    .replace(/([.!?,;:])\1+/g, "$1")        // collapse repeated punctuation
    .replace(/\n{3,}/g, "\n\n")             // collapse excessive newlines
    .replace(/[ \t]{2,}/g, " ")             // collapse whitespace
    .trim();
}
