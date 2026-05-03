export type OperatorDomain =
	| 'market-analysis'
	| 'technical-roadmap'
	| 'financial-analysis'
	| 'onboarding'
	| 'custom';

export const ALL_OPERATOR_DOMAINS: readonly OperatorDomain[] = [
	'market-analysis',
	'technical-roadmap',
	'financial-analysis',
	'onboarding',
	'custom'
] as const;

export type TrackedEntities = {
	entities: string[];
	keywords: string[];
	technologies: string[];
};

export type OperatorContext = {
	operatorName: string;
	role: string;
	orgName: string;
	domain: OperatorDomain;
	allowedGitHubLogins: string[];
	groundingUrls: string[];
	positioning: string;
	audience: string;
	hardRules: string[];
	glossary: Record<string, string>;
	trackedEntities: TrackedEntities;
};

export class OperatorContextNotConfiguredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OperatorContextNotConfiguredError';
	}
}
