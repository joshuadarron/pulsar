import { editor, input, select } from '@inquirer/prompts';
import type { Domain, SetupConfig, VoiceFormat } from './types.js';
import { DOMAINS, VOICE_FORMATS } from './types.js';
import { writeConfig } from './write-config.js';

export type InitInteractiveOptions = {
	cwd: string;
};

/**
 * Walk the operator through interactive prompts and write the resulting
 * .voice/ and .context/ trees. Cancellation (Ctrl+C) bubbles up as an
 * @inquirer/prompts ExitPromptError, which the CLI entry point catches.
 */
export async function initInteractive(
	opts: InitInteractiveOptions
): Promise<{ voiceDir: string; contextDir: string; files: string[] }> {
	const operatorName = await input({
		message: 'Operator name (your name)',
		validate: requireNonEmpty
	});
	const role = await input({ message: 'Your role', validate: requireNonEmpty });
	const orgName = await input({
		message: 'Org or product name',
		validate: requireNonEmpty
	});
	const positioning = await input({
		message: 'Positioning statement (one sentence)',
		validate: requireNonEmpty
	});
	const audience = await input({
		message: 'Audience (who you serve)',
		validate: requireNonEmpty
	});
	const domain = (await select({
		message: 'Domain',
		choices: DOMAINS.map((value) => ({ name: value, value }))
	})) as Domain;

	const hardRules = await editorOrSkip(
		'Hard rules (one per line, opens $EDITOR; leave blank to skip)'
	);
	const trackedEntitiesRaw = await input({
		message: 'Tracked entities (comma separated, blank to skip)'
	});
	const keywordsRaw = await input({
		message: 'Tracked keywords (comma separated, blank to skip)'
	});
	const technologiesRaw = await input({
		message: 'Tracked technologies (comma separated, blank to skip)'
	});
	const allowedRaw = await input({
		message: 'Allowed GitHub logins for auth (comma separated)',
		validate: requireNonEmpty
	});
	const groundingRaw = await input({
		message: 'Grounding URLs the agent can scrape (comma separated, blank to skip)'
	});

	const toneRules = await editorOrSkip('Tone rules (one per line, blank to skip)');
	const sentencePatterns = await editorOrSkip('Sentence patterns (one per line, blank to skip)');
	const neverWrite = await editorOrSkip('What never to write (one per line, blank to skip)');

	const samples: Partial<Record<VoiceFormat, string[]>> = {};
	for (const format of VOICE_FORMATS) {
		const formatSamples = await collectSamplesForFormat(format);
		if (formatSamples.length > 0) {
			samples[format] = formatSamples;
		}
	}

	const config: SetupConfig = {
		operatorName,
		role,
		orgName,
		domain,
		positioning,
		audience,
		hardRules,
		trackedEntities: splitList(trackedEntitiesRaw),
		keywords: splitList(keywordsRaw),
		technologies: splitList(technologiesRaw),
		allowedGitHubLogins: splitList(allowedRaw),
		groundingUrls: splitList(groundingRaw),
		voice: {
			toneRules,
			sentencePatterns,
			neverWrite,
			samples
		}
	};

	return writeConfig(config, { cwd: opts.cwd });
}

async function collectSamplesForFormat(format: VoiceFormat): Promise<string[]> {
	const choice = await select({
		message: `Add voice samples for ${format}?`,
		choices: [
			{ name: 'Skip this format', value: 'skip' },
			{ name: 'Paste 1 sample', value: '1' },
			{ name: 'Paste 2 samples', value: '2' },
			{ name: 'Paste 3 samples', value: '3' }
		]
	});
	if (choice === 'skip') {
		return [];
	}
	const count = Number.parseInt(choice as string, 10);
	const out: string[] = [];
	for (let i = 0; i < count; i += 1) {
		const sample = await editor({
			message: `Sample ${i + 1} for ${format} (opens $EDITOR)`,
			waitForUserInput: false
		});
		out.push(sample);
	}
	return out;
}

async function editorOrSkip(message: string): Promise<string> {
	try {
		const value = await editor({ message, waitForUserInput: false });
		return value;
	} catch (err) {
		// editor() falls back to input on systems without $EDITOR; rethrow if user cancelled.
		if (isExitPromptError(err)) {
			throw err;
		}
		return await input({ message: `${message} (text input)` });
	}
}

function isExitPromptError(err: unknown): boolean {
	return (
		typeof err === 'object' &&
		err !== null &&
		'name' in err &&
		(err as { name: string }).name === 'ExitPromptError'
	);
}

function requireNonEmpty(value: string): true | string {
	return value.trim().length > 0 ? true : 'Required';
}

function splitList(raw: string): string[] {
	return raw
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}
