import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import {
	ALL_OPERATOR_DOMAINS,
	type OperatorContext,
	OperatorContextNotConfiguredError,
	type OperatorDomain,
	type TrackedEntities
} from './types.js';

type Frontmatter = Record<string, unknown>;

type ParsedMarkdown = {
	frontmatter: Frontmatter;
	body: string;
};

function resolveContextDir(): string {
	const configured = process.env.PULSAR_CONTEXT_DIR ?? '.context';
	return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
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

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === 'string');
}

function isOperatorDomain(value: unknown): value is OperatorDomain {
	return typeof value === 'string' && (ALL_OPERATOR_DOMAINS as readonly string[]).includes(value);
}

function loadProfile(contextDir: string): {
	operatorName: string;
	role: string;
	orgName: string;
	domain: OperatorDomain;
	allowedGitHubLogins: string[];
	groundingUrls: string[];
	positioning: string;
	audience: string;
} {
	const profilePath = path.join(contextDir, 'profile.md');
	if (!existsSync(profilePath)) {
		throw new OperatorContextNotConfiguredError(
			`Operator profile not found at ${profilePath}. Run pnpm setup to configure your operator context.`
		);
	}
	const raw = readFileSync(profilePath, 'utf8');
	const { frontmatter, body } = parseFrontmatter(raw);

	const domainRaw = frontmatter.domain;
	const domain: OperatorDomain = isOperatorDomain(domainRaw) ? domainRaw : 'custom';

	return {
		operatorName: asString(frontmatter.operatorName),
		role: asString(frontmatter.role),
		orgName: asString(frontmatter.orgName),
		domain,
		allowedGitHubLogins: asStringArray(frontmatter.allowedGitHubLogins),
		groundingUrls: asStringArray(frontmatter.groundingUrls),
		positioning: readBodySection(body, 'Positioning'),
		audience: readBodySection(body, 'Audience')
	};
}

function loadHardRules(contextDir: string): string[] {
	const rulesPath = path.join(contextDir, 'hard-rules.md');
	if (!existsSync(rulesPath)) return [];
	const raw = readFileSync(rulesPath, 'utf8');
	const { body } = parseFrontmatter(raw);
	const lines = body.split(/\r?\n/);
	const rules: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
			rules.push(trimmed.slice(2).trim());
		}
	}
	return rules;
}

function loadGlossary(contextDir: string): Record<string, string> {
	const glossaryPath = path.join(contextDir, 'glossary.md');
	if (!existsSync(glossaryPath)) return {};
	const raw = readFileSync(glossaryPath, 'utf8');
	const { body } = parseFrontmatter(raw);
	const out: Record<string, string> = {};

	const lines = body.split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
			const item = trimmed.slice(2);
			const colonIdx = item.indexOf(':');
			if (colonIdx > 0) {
				const term = item.slice(0, colonIdx).trim();
				const def = item.slice(colonIdx + 1).trim();
				if (term) out[term] = def;
			}
			continue;
		}

		if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
			const cells = trimmed
				.slice(1, -1)
				.split('|')
				.map((c) => c.trim());
			if (cells.length < 2) continue;
			const [term, def] = cells;
			if (!term || !def) continue;
			if (term.toLowerCase() === 'term' && def.toLowerCase() === 'definition') continue;
			if (/^[-:\s]+$/.test(term) && /^[-:\s]+$/.test(def)) continue;
			out[term] = def;
		}
	}
	return out;
}

function loadTrackedEntities(contextDir: string): TrackedEntities {
	const entitiesPath = path.join(contextDir, 'tracked-entities.md');
	if (!existsSync(entitiesPath)) {
		return { entities: [], keywords: [], technologies: [] };
	}
	const raw = readFileSync(entitiesPath, 'utf8');
	const { frontmatter } = parseFrontmatter(raw);
	return {
		entities: asStringArray(frontmatter.entities),
		keywords: asStringArray(frontmatter.keywords),
		technologies: asStringArray(frontmatter.technologies)
	};
}

/**
 * Load the operator context from the configured context directory.
 *
 * Reads `<PULSAR_CONTEXT_DIR>/profile.md` plus optional `hard-rules.md`,
 * `glossary.md`, and `tracked-entities.md`. Pipelines refuse to start if
 * `profile.md` is missing.
 *
 * @returns The parsed operator context.
 * @throws {OperatorContextNotConfiguredError} If the operator profile file is missing.
 */
export function loadOperatorContext(): OperatorContext {
	const contextDir = resolveContextDir();
	const profile = loadProfile(contextDir);
	return {
		...profile,
		hardRules: loadHardRules(contextDir),
		glossary: loadGlossary(contextDir),
		trackedEntities: loadTrackedEntities(contextDir)
	};
}
