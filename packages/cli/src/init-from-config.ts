import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Domain, SetupConfig, VoiceFormat } from './types.js';
import { DOMAINS, VOICE_FORMATS } from './types.js';
import { writeConfig } from './write-config.js';

export type InitFromConfigOptions = {
	cwd: string;
	configPath: string;
};

/**
 * Read a YAML file matching the schema in sample-config.example.yaml,
 * normalize it to a SetupConfig, and write the resulting .voice/ and
 * .context/ trees to disk.
 */
export function initFromConfig(opts: InitFromConfigOptions): {
	voiceDir: string;
	contextDir: string;
	files: string[];
} {
	const absolute = path.isAbsolute(opts.configPath)
		? opts.configPath
		: path.join(opts.cwd, opts.configPath);
	const raw = readFileSync(absolute, 'utf8');
	const parsed = parseYaml(raw) as Record<string, unknown> | null;
	if (!parsed || typeof parsed !== 'object') {
		throw new Error(`Config file ${absolute} did not parse to an object.`);
	}
	const config = normalizeConfig(parsed);
	return writeConfig(config, { cwd: opts.cwd });
}

function normalizeConfig(raw: Record<string, unknown>): SetupConfig {
	const operator = asObject(raw.operator);
	const org = asObject(raw.org);
	const audienceField = raw.audience;
	const context = asObject(raw.context);
	const voice = asObject(raw.voice);

	const operatorName = asString(operator.name, 'operator.name');
	const role = asString(operator.role, 'operator.role');
	const orgName = asString(org.name, 'org.name');
	const positioning = asString(org.positioning, 'org.positioning');
	const audience =
		typeof audienceField === 'string' ? audienceField : asString(context.audience, 'audience');
	const domain = asDomain(raw.domain);

	const hardRules = arrayToBullets(asArrayOfStrings(context.hardRules, 'context.hardRules'));
	const glossaryEntries = asArrayOfStrings(context.glossary, 'context.glossary');
	const glossary =
		glossaryEntries.length > 0 ? glossaryEntries.map((entry) => `- ${entry}`).join('\n') : '';
	const trackedEntities = asArrayOfStrings(context.trackedEntities, 'context.trackedEntities');
	const keywords = asArrayOfStrings(context.keywords, 'context.keywords');
	const technologies = asArrayOfStrings(context.technologies, 'context.technologies');
	const allowedGitHubLogins = asArrayOfStrings(raw.allowedGitHubLogins, 'allowedGitHubLogins');
	const groundingUrls = asArrayOfStrings(context.groundingUrls, 'context.groundingUrls');

	const toneRules = arrayToBullets(asArrayOfStrings(voice.toneRules, 'voice.toneRules'));
	const sentencePatterns = arrayToBullets(
		asArrayOfStrings(voice.sentencePatterns, 'voice.sentencePatterns')
	);
	const neverWrite = arrayToBullets(asArrayOfStrings(voice.neverWrite, 'voice.neverWrite'));

	const samples = normalizeSamples(voice.samples);

	return {
		operatorName,
		role,
		orgName,
		domain,
		positioning,
		audience,
		hardRules,
		glossary,
		trackedEntities,
		keywords,
		technologies,
		allowedGitHubLogins,
		groundingUrls,
		voice: {
			toneRules,
			sentencePatterns,
			neverWrite,
			samples
		}
	};
}

function asObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
	if (typeof value !== 'string') {
		throw new Error(`Expected string for ${label}, got ${typeof value}`);
	}
	return value;
}

function asDomain(value: unknown): Domain {
	if (typeof value === 'string' && (DOMAINS as string[]).includes(value)) {
		return value as Domain;
	}
	throw new Error(`Expected domain to be one of ${DOMAINS.join(', ')}, got ${String(value)}`);
}

function asArrayOfStrings(value: unknown, label: string): string[] {
	if (value === undefined || value === null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new Error(`Expected array for ${label}, got ${typeof value}`);
	}
	return value.map((entry, index) => {
		if (typeof entry !== 'string') {
			throw new Error(`Expected ${label}[${index}] to be a string`);
		}
		return entry;
	});
}

function arrayToBullets(items: string[]): string {
	if (items.length === 0) {
		return '';
	}
	return items.map((item) => `- ${item}`).join('\n');
}

function normalizeSamples(value: unknown): Partial<Record<VoiceFormat, string[]>> {
	const out: Partial<Record<VoiceFormat, string[]>> = {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return out;
	}
	const obj = value as Record<string, unknown>;
	for (const format of VOICE_FORMATS) {
		const raw = obj[format];
		if (raw === undefined || raw === null) {
			continue;
		}
		if (!Array.isArray(raw)) {
			throw new Error(`Expected voice.samples.${format} to be an array of strings`);
		}
		const samples = raw.map((entry, index) => {
			if (typeof entry !== 'string') {
				throw new Error(`Expected voice.samples.${format}[${index}] to be a string`);
			}
			return entry;
		});
		out[format] = samples;
	}
	return out;
}
