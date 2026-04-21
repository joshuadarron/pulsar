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
      // Try cleaning trailing commas
      try {
        return JSON.parse(cleanJson(fenceMatch[1].trim()));
      } catch {
        // ignore
      }
    }
  }

  // Try to find first { ... } block (balanced braces)
  const start = raw.indexOf("{");
  if (start !== -1) {
    const candidate = extractBalancedBraces(raw, start);
    if (candidate) {
      try {
        return JSON.parse(candidate);
      } catch {
        try {
          return JSON.parse(cleanJson(candidate));
        } catch {
          // ignore
        }
      }
    }
  }

  // Last resort: find last { ... } block
  const lastEnd = raw.lastIndexOf("}");
  if (start !== -1 && lastEnd > start) {
    try {
      return JSON.parse(raw.slice(start, lastEnd + 1));
    } catch {
      try {
        return JSON.parse(cleanJson(raw.slice(start, lastEnd + 1)));
      } catch {
        // ignore
      }
    }
  }

  throw new SyntaxError(`Could not extract JSON from response: ${raw.slice(0, 100)}...`);
}

function cleanJson(str: string): string {
  // Remove trailing commas before } or ]
  return str.replace(/,\s*([}\]])/g, "$1");
}

function extractBalancedBraces(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
