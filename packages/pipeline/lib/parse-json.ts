/**
 * Extract and parse JSON from an LLM response that may contain
 * markdown, preamble, or other non-JSON text wrapping the object.
 * Also handles Python-style single-quoted dicts from some runtimes.
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
    const fenced = fenceMatch[1].trim();
    const parsed = tryParseVariants<T>(fenced);
    if (parsed !== undefined) return parsed;
  }

  // Try to find first { ... } block (balanced braces, handles both quote styles)
  const start = raw.indexOf("{");
  if (start !== -1) {
    const candidate = extractBalancedBraces(raw, start);
    if (candidate) {
      const parsed = tryParseVariants<T>(candidate);
      if (parsed !== undefined) return parsed;
    }
  }

  // Last resort: find last { ... } block
  const lastEnd = raw.lastIndexOf("}");
  if (start !== -1 && lastEnd > start) {
    const slice = raw.slice(start, lastEnd + 1);
    const parsed = tryParseVariants<T>(slice);
    if (parsed !== undefined) return parsed;
  }

  throw new SyntaxError(`Could not extract JSON from response: ${raw.slice(0, 100)}...`);
}

/** Try JSON.parse, then with trailing-comma cleanup, then with single-quote normalization. */
function tryParseVariants<T>(str: string): T | undefined {
  try { return JSON.parse(str); } catch { /* ignore */ }
  try { return JSON.parse(cleanJson(str)); } catch { /* ignore */ }
  // Python-style single-quoted dicts: normalize structural quotes to double
  const normalized = normalizePythonDict(str);
  if (normalized !== str) {
    try { return JSON.parse(normalized); } catch { /* ignore */ }
    try { return JSON.parse(cleanJson(normalized)); } catch { /* ignore */ }
  }
  return undefined;
}

function cleanJson(str: string): string {
  // Remove trailing commas before } or ]
  return str.replace(/,\s*([}\]])/g, "$1");
}

function extractBalancedBraces(text: string, start: number): string | null {
  let depth = 0;
  let stringChar: string | null = null;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    // Track both single and double quoted strings
    if (stringChar === null && (ch === '"' || ch === "'")) { stringChar = ch; continue; }
    if (ch === stringChar) { stringChar = null; continue; }
    if (stringChar !== null) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Convert Python-style single-quoted dict notation to valid JSON.
 * Replaces structural single quotes (around keys and values) with double quotes
 * while preserving apostrophes inside string content.
 *
 * Works by walking the string character-by-character, tracking whether we are
 * inside a quoted value. Structural quotes appear after { [ , : or before } ] , :
 * while content apostrophes appear mid-word.
 */
function normalizePythonDict(str: string): string {
  const chars = [...str];
  const out: string[] = [];
  let inString = false;
  let quoteChar = "";

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    // Handle escape sequences inside strings
    if (inString && ch === "\\") {
      out.push(ch);
      if (i + 1 < chars.length) {
        i++;
        // Convert escaped single quote to escaped double quote
        out.push(chars[i] === "'" ? '"' : chars[i]);
      }
      continue;
    }

    if (inString) {
      if (ch === quoteChar) {
        // Closing quote — emit as double quote
        out.push('"');
        inString = false;
      } else if (ch === '"') {
        // Double quote inside single-quoted string — escape it
        out.push('\\"');
      } else {
        out.push(ch);
      }
      continue;
    }

    // Outside any string
    if (ch === "'" || ch === '"') {
      out.push('"');
      inString = true;
      quoteChar = ch;
      continue;
    }

    // Python True/False/None → JSON equivalents
    if (ch === "T" && str.slice(i, i + 4) === "True") {
      out.push("true");
      i += 3;
      continue;
    }
    if (ch === "F" && str.slice(i, i + 5) === "False") {
      out.push("false");
      i += 4;
      continue;
    }
    if (ch === "N" && str.slice(i, i + 4) === "None") {
      out.push("null");
      i += 3;
      continue;
    }

    out.push(ch);
  }

  return out.join("");
}
