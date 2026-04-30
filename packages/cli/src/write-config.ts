import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { SetupConfig, VoiceFormat } from './types.js';
import { VOICE_FORMATS } from './types.js';

const PLACEHOLDER_TONE = '<!-- Add tone rules here. One bullet per rule. -->';
const PLACEHOLDER_PATTERNS = '<!-- Add sentence patterns here. -->';
const PLACEHOLDER_NEVER = '<!-- Add things to never write here. -->';
const PLACEHOLDER_HARD_RULES = '<!-- Add hard rules, one per line. -->';
const PLACEHOLDER_GLOSSARY = '<!-- term: definition (one per line). -->';
const PLACEHOLDER_POSITIONING = '<!-- Add a one sentence positioning statement here. -->';
const PLACEHOLDER_AUDIENCE = '<!-- Describe the audience here. -->';
const PLACEHOLDER_TRACKED_BODY =
	'<!-- Free-form notes on tracked entities, keywords, and technologies. -->';

export type WriteOptions = {
	cwd: string;
	voiceDir?: string;
	contextDir?: string;
};

export type WriteResult = {
	voiceDir: string;
	contextDir: string;
	files: string[];
};

/**
 * Write the .voice/ and .context/ directory tree from a SetupConfig.
 *
 * Never overwrites pre-existing files at the top level: if a target file
 * already exists, the writer skips it and reports the path back so the caller
 * can warn. Sample files are skipped per-format if any samples already exist.
 */
export function writeConfig(config: SetupConfig, opts: WriteOptions): WriteResult {
	const voiceDir = opts.voiceDir ?? path.join(opts.cwd, '.voice');
	const contextDir = opts.contextDir ?? path.join(opts.cwd, '.context');

	mkdirSync(voiceDir, { recursive: true });
	mkdirSync(contextDir, { recursive: true });

	const files: string[] = [];

	files.push(...writeContextProfile(contextDir, config));
	files.push(...writeContextHardRules(contextDir, config));
	files.push(...writeContextGlossary(contextDir, config));
	files.push(...writeContextTrackedEntities(contextDir, config));
	files.push(...writeVoiceProfile(voiceDir, config));
	files.push(...writeVoiceSamples(voiceDir, config));

	return { voiceDir, contextDir, files };
}

function writeIfMissing(filePath: string, body: string): string[] {
	if (existsSync(filePath)) {
		return [];
	}
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, body, 'utf8');
	return [filePath];
}

function writeContextProfile(contextDir: string, config: SetupConfig): string[] {
	const frontmatter = {
		operatorName: config.operatorName,
		role: config.role,
		orgName: config.orgName,
		domain: config.domain,
		allowedGitHubLogins: config.allowedGitHubLogins,
		groundingUrls: config.groundingUrls
	};
	const body = [
		'# Positioning',
		'',
		config.positioning.trim() || PLACEHOLDER_POSITIONING,
		'',
		'# Audience',
		'',
		config.audience.trim() || PLACEHOLDER_AUDIENCE,
		''
	].join('\n');
	const file = path.join(contextDir, 'profile.md');
	return writeIfMissing(file, withFrontmatter(frontmatter, body));
}

function writeContextHardRules(contextDir: string, config: SetupConfig): string[] {
	const trimmed = config.hardRules.trim();
	const body = trimmed.length > 0 ? `${trimmed}\n` : `${PLACEHOLDER_HARD_RULES}\n`;
	const file = path.join(contextDir, 'hard-rules.md');
	return writeIfMissing(file, body);
}

function writeContextGlossary(contextDir: string, config: SetupConfig): string[] {
	const trimmed = (config.glossary ?? '').trim();
	const body = trimmed.length > 0 ? `${trimmed}\n` : `${PLACEHOLDER_GLOSSARY}\n`;
	const file = path.join(contextDir, 'glossary.md');
	return writeIfMissing(file, body);
}

function writeContextTrackedEntities(contextDir: string, config: SetupConfig): string[] {
	const frontmatter = {
		entities: config.trackedEntities,
		keywords: config.keywords,
		technologies: config.technologies
	};
	const body = `${PLACEHOLDER_TRACKED_BODY}\n`;
	const file = path.join(contextDir, 'tracked-entities.md');
	return writeIfMissing(file, withFrontmatter(frontmatter, body));
}

function writeVoiceProfile(voiceDir: string, config: SetupConfig): string[] {
	const frontmatter = {
		formats: VOICE_FORMATS
	};
	const body = [
		'# Tone',
		'',
		config.voice.toneRules.trim() || PLACEHOLDER_TONE,
		'',
		'# Sentence patterns',
		'',
		config.voice.sentencePatterns.trim() || PLACEHOLDER_PATTERNS,
		'',
		'# What never to write',
		'',
		config.voice.neverWrite.trim() || PLACEHOLDER_NEVER,
		''
	].join('\n');
	const file = path.join(voiceDir, 'profile.md');
	return writeIfMissing(file, withFrontmatter(frontmatter, body));
}

function writeVoiceSamples(voiceDir: string, config: SetupConfig): string[] {
	const written: string[] = [];
	for (const format of VOICE_FORMATS) {
		const dir = path.join(voiceDir, 'samples', format);
		mkdirSync(dir, { recursive: true });
		const samples = config.voice.samples[format as VoiceFormat] ?? [];
		if (samples.length === 0) {
			const file = path.join(dir, 'README.md');
			const body = `<!-- Drop ${format} writing samples here as sample-1.md, sample-2.md, etc. -->\n`;
			written.push(...writeIfMissing(file, body));
			continue;
		}
		samples.forEach((sample, index) => {
			const file = path.join(dir, `sample-${index + 1}.md`);
			const trimmed = sample.trim();
			const body = trimmed.length > 0 ? `${trimmed}\n` : '<!-- empty sample -->\n';
			written.push(...writeIfMissing(file, body));
		});
	}
	return written;
}

function withFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
	const yaml = stringifyYaml(frontmatter).trimEnd();
	return `---\n${yaml}\n---\n\n${body}`;
}
