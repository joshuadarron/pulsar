export type Domain =
	| 'market-analysis'
	| 'technical-roadmap'
	| 'financial-analysis'
	| 'onboarding'
	| 'custom';

export type VoiceFormat = 'long-form' | 'linkedin' | 'reddit' | 'discord' | 'twitter' | 'other';

export const VOICE_FORMATS: VoiceFormat[] = [
	'long-form',
	'linkedin',
	'reddit',
	'discord',
	'twitter',
	'other'
];

export const DOMAINS: Domain[] = [
	'market-analysis',
	'technical-roadmap',
	'financial-analysis',
	'onboarding',
	'custom'
];

/**
 * Structured payload produced by either the interactive flow or YAML loader,
 * then handed to write-config.ts. The shape mirrors what the loaders package
 * will read back from disk via loadOperatorContext / loadVoiceContext.
 */
export type SetupConfig = {
	operatorName: string;
	role: string;
	orgName: string;
	domain: Domain;
	positioning: string;
	audience: string;
	hardRules: string;
	glossary?: string;
	trackedEntities: string[];
	keywords: string[];
	technologies: string[];
	allowedGitHubLogins: string[];
	groundingUrls: string[];
	voice: {
		toneRules: string;
		sentencePatterns: string;
		neverWrite: string;
		samples: Partial<Record<VoiceFormat, string[]>>;
	};
};
