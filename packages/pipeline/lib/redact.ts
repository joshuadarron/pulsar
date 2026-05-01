// ---------------------------------------------------------------------------
// Secret redaction for everything the rocketride listener persists.
//
// The rocketride server emits status events whose payload includes the
// per-task webhook auth-key / token-key plus other one-off credentials. The
// listener writes those events into run_logs, pipeline_run_traces, and
// orphan_events. Without redaction those secrets end up on disk and visible
// in the run-detail UI's log pane and copy-to-clipboard output.
//
// Two layers, applied at every insert site:
//
//   1. Object-level: deep walk objects, replace any value whose KEY name is in
//      SECRET_KEY_NAMES with "***". Catches structured payloads like
//      { "auth-key": "pk_..." }.
//
//   2. String-level: regex sweep for known secret token prefixes (rocketride
//      tk_/pk_, OpenAI/Anthropic sk-, GitHub ghp_, AWS AKIA, Slack xox). Each
//      match becomes "<prefix>***" so the operator can still see what kind of
//      token leaked. Catches secrets embedded in pre-stringified messages and
//      in string leaf values of structured payloads.
//
// Both layers run on every payload the listener persists. New key shapes only
// need a single pattern added here to be redacted across all three tables.
// ---------------------------------------------------------------------------

const SECRET_KEY_NAMES = new Set([
	'auth-key',
	'token-key',
	'apikey',
	'api_key',
	'api-key',
	'secret',
	'password',
	'authorization'
]);

const SECRET_VALUE_PATTERNS: Array<{ re: RegExp; prefix: string }> = [
	{ re: /\btk_[a-f0-9]{16,}\b/gi, prefix: 'tk_' },
	{ re: /\bpk_[a-f0-9]{16,}\b/gi, prefix: 'pk_' },
	{ re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, prefix: 'sk-' },
	{ re: /\bghp_[A-Za-z0-9]{36}\b/g, prefix: 'ghp_' },
	{ re: /\bAKIA[A-Z0-9]{16}\b/g, prefix: 'AKIA' },
	{ re: /\bxox[bapsr]-[A-Za-z0-9-]{20,}\b/g, prefix: 'xox-' }
];

/**
 * Redact secret-shaped substrings in a string. Each known token prefix is
 * preserved so the operator can still identify the leak source from logs.
 */
export function redactString(input: string): string {
	let out = input;
	for (const { re, prefix } of SECRET_VALUE_PATTERNS) {
		out = out.replace(re, `${prefix}***`);
	}
	return out;
}

/**
 * Deep-redact a value before it is stringified for storage.
 *
 * - String leaves run through redactString.
 * - Object values whose KEY appears in SECRET_KEY_NAMES become "***" verbatim.
 * - Arrays and nested objects recurse.
 * - Anything else (numbers, booleans, null, undefined) passes through.
 */
export function redactJson<T = unknown>(input: T): T {
	if (input === null || input === undefined) return input;
	if (typeof input === 'string') return redactString(input) as unknown as T;
	if (typeof input !== 'object') return input;
	if (Array.isArray(input)) {
		return (input as unknown[]).map((v) => redactJson(v)) as unknown as T;
	}
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
		if (SECRET_KEY_NAMES.has(k.toLowerCase())) {
			out[k] = '***';
			continue;
		}
		out[k] = redactJson(v);
	}
	return out as unknown as T;
}
