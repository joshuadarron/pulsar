/**
 * Extract and parse JSON from an LLM response that may contain
 * markdown, preamble, or other non-JSON text wrapping the object.
 */
export function extractJson<T = Record<string, unknown>>(raw: string): T {
  // Try direct parse first
  try {
    return JSON.parse(raw);
  } catch {
    // ignore
  }

  // Try to find JSON in a code fence
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // ignore
    }
  }

  // Try to find first { ... } block
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      // ignore
    }
  }

  throw new SyntaxError(`Could not extract JSON from response: ${raw.slice(0, 100)}...`);
}
