import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import {
	ALL_VOICE_FORMATS,
	type VoiceContext,
	VoiceContextNotConfiguredError,
	type VoiceFormat,
	type VoiceProfile
} from './types.js';

const SAMPLES_PER_FORMAT_LIMIT = 3;
const TOTAL_CHAR_BUDGET = 32000;

type Frontmatter = Record<string, unknown>;

type ParsedMarkdown = {
	frontmatter: Frontmatter;
	body: string;
};

function findVoiceDirUpwards(startDir: string): string | null {
	let dir = startDir;
	while (true) {
		const candidate = path.join(dir, '.voice');
		if (existsSync(path.join(candidate, 'profile.md'))) {
			return candidate;
		}
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function resolveVoiceDir(): string {
	const configured = process.env.PULSAR_VOICE_DIR;
	if (configured && configured.length > 0) {
		return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
	}
	const found = findVoiceDirUpwards(process.cwd());
	if (found) return found;
	return path.join(process.cwd(), '.voice');
}

function parseFrontmatter(raw: string): ParsedMarkdown {
	const fenceMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!fenceMatch) {
		return { frontmatter: {}, body: raw };
	}
	const yamlBlock = fenceMatch[1];
	const body = fenceMatch[2] ?? '';
	const parsed = yaml.load(yamlBlock);
	const frontmatter = parsed && typeof parsed === 'object' ? (parsed as Frontmatter) : {};
	return { frontmatter, body };
}

function isVoiceFormat(value: unknown): value is VoiceFormat {
	return typeof value === 'string' && (ALL_VOICE_FORMATS as readonly string[]).includes(value);
}

function readBodySection(body: string, header: string): string {
	const lines = body.split(/\r?\n/);
	const lower = header.toLowerCase();
	let start = -1;
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i].trim();
		if (line.startsWith('# ') && line.slice(2).trim().toLowerCase() === lower) {
			start = i + 1;
			break;
		}
	}
	if (start === -1) {
		return '';
	}
	const collected: string[] = [];
	for (let i = start; i < lines.length; i += 1) {
		const line = lines[i];
		if (/^#\s+\S/.test(line.trim())) {
			break;
		}
		collected.push(line);
	}
	return collected.join('\n').trim();
}

function loadProfile(voiceDir: string): VoiceProfile {
	const profilePath = path.join(voiceDir, 'profile.md');
	if (!existsSync(profilePath)) {
		throw new VoiceContextNotConfiguredError(
			`Voice profile not found at ${profilePath}. Run pnpm setup to configure your voice context.`
		);
	}
	const raw = readFileSync(profilePath, 'utf8');
	const { frontmatter, body } = parseFrontmatter(raw);

	const formatsRaw = Array.isArray(frontmatter.formats) ? frontmatter.formats : [];
	const formats = formatsRaw.filter(isVoiceFormat);

	return {
		tone: readBodySection(body, 'Tone'),
		sentencePatterns: readBodySection(body, 'Sentence patterns'),
		neverWrite: readBodySection(body, 'What never to write'),
		formats
	};
}

function readSampleFiles(voiceDir: string, format: VoiceFormat): string[] {
	const formatDir = path.join(voiceDir, 'samples', format);
	if (!existsSync(formatDir)) {
		return [];
	}
	let entries: string[];
	try {
		entries = readdirSync(formatDir);
	} catch {
		return [];
	}
	const files = entries
		.filter((name) => name.endsWith('.md'))
		.map((name) => path.join(formatDir, name))
		.filter((full) => {
			try {
				return statSync(full).isFile();
			} catch {
				return false;
			}
		})
		.sort();

	const limited = files.slice(0, SAMPLES_PER_FORMAT_LIMIT);
	return limited.map((full) => readFileSync(full, 'utf8'));
}

function emptySamples(): Record<VoiceFormat, string[]> {
	const out: Record<VoiceFormat, string[]> = {
		'long-form': [],
		linkedin: [],
		reddit: [],
		discord: [],
		twitter: [],
		other: []
	};
	return out;
}

function applyTokenCap(samples: Record<VoiceFormat, string[]>): Record<VoiceFormat, string[]> {
	type Indexed = { format: VoiceFormat; index: number; length: number };

	let total = 0;
	const indexed: Indexed[] = [];
	for (const format of ALL_VOICE_FORMATS) {
		const list = samples[format];
		for (let i = 0; i < list.length; i += 1) {
			const len = list[i].length;
			total += len;
			indexed.push({ format, index: i, length: len });
		}
	}

	if (total <= TOTAL_CHAR_BUDGET) {
		return samples;
	}

	indexed.sort((a, b) => b.length - a.length);
	const dropIndex = new Set<string>();
	for (const item of indexed) {
		if (total <= TOTAL_CHAR_BUDGET) break;
		dropIndex.add(`${item.format}:${item.index}`);
		total -= item.length;
	}

	const out = emptySamples();
	for (const format of ALL_VOICE_FORMATS) {
		out[format] = samples[format].filter((_, i) => !dropIndex.has(`${format}:${i}`));
	}
	return out;
}

/**
 * Load operator voice context from the configured voice directory.
 *
 * Reads `<PULSAR_VOICE_DIR>/profile.md` for tone rules and reads up to 3
 * markdown samples per requested format from `<PULSAR_VOICE_DIR>/samples/<format>/`.
 * Caps total injected sample size at roughly 8000 tokens (32000 characters)
 * by dropping the longest samples first.
 *
 * @param formats Voice formats whose samples should be loaded.
 * @returns The parsed voice profile and sample map.
 * @throws {VoiceContextNotConfiguredError} If the voice profile file is missing.
 */
export function loadVoiceContext(formats: VoiceFormat[]): VoiceContext {
	const voiceDir = resolveVoiceDir();
	const profile = loadProfile(voiceDir);

	const samples = emptySamples();
	const seen = new Set<VoiceFormat>();
	for (const format of formats) {
		if (seen.has(format)) continue;
		seen.add(format);
		samples[format] = readSampleFiles(voiceDir, format);
	}

	return {
		profile,
		samples: applyTokenCap(samples)
	};
}
