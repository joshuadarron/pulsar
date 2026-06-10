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

/**
 * Operator-curated reference to a prior post or repo. Article-generation
 * consumes this list as cross-reference candidates without pulling the body
 * into the analytical corpus. The `url` is optional so prompts can render
 * a real inline link when present and fall back to the slug otherwise.
 */
export type PastArticleRef = {
	slug: string;
	title: string;
	angle: string;
	url?: string;
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
	authorIdentity: string;
	anchorPhrase: string;
	pastArticles: PastArticleRef[];
};

export class OperatorContextNotConfiguredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OperatorContextNotConfiguredError';
	}
}
