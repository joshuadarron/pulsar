import type { OperatorContext } from '@pulsar/operator-context';
import { env } from '@pulsar/shared/config/env';

import type { ProductContext, ProductPackageMetadata } from '../types.js';

export type BuildProductOptions = {
	operator: OperatorContext;
	/** When true, skip the network fetch and return positioning + groundingUrls only.
	 *  Useful for tests and offline runs. Default false. */
	metadataOnly?: boolean;
};

type ClassifiedUrl =
	| { kind: 'npm'; packageName: string; original: string }
	| { kind: 'pypi'; packageName: string; original: string }
	| { kind: 'vscode'; itemName: string; original: string }
	| { kind: 'openvsx'; publisher: string; extension: string; original: string }
	| { kind: 'web'; original: string };

function classifyUrl(raw: string): ClassifiedUrl {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return { kind: 'web', original: raw };
	}

	const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
	const segments = parsed.pathname.split('/').filter(Boolean);

	if (host === 'npmjs.com' && segments[0] === 'package' && segments.length >= 2) {
		const rest = segments.slice(1);
		const packageName = rest[0]?.startsWith('@') && rest[1] ? `${rest[0]}/${rest[1]}` : rest[0];
		if (packageName) return { kind: 'npm', packageName, original: raw };
	}

	if (host === 'pypi.org' && segments[0] === 'project' && segments[1]) {
		return { kind: 'pypi', packageName: segments[1], original: raw };
	}

	if (host === 'marketplace.visualstudio.com' && segments[0] === 'items') {
		const itemName = parsed.searchParams.get('itemName');
		if (itemName) return { kind: 'vscode', itemName, original: raw };
	}

	if (host === 'open-vsx.org' && segments[0] === 'extension' && segments[1] && segments[2]) {
		return {
			kind: 'openvsx',
			publisher: segments[1],
			extension: segments[2],
			original: raw
		};
	}

	return { kind: 'web', original: raw };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
	return res.json() as Promise<T>;
}

type PyPIResponse = {
	info: {
		name: string;
		version: string;
		summary?: string;
	};
};

async function fetchPyPI(packageName: string): Promise<ProductPackageMetadata> {
	const data = await fetchJson<PyPIResponse>(
		`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`
	);
	return {
		name: data.info.name,
		version: data.info.version,
		summary: data.info.summary ?? ''
	};
}

type NpmResponse = {
	name: string;
	'dist-tags'?: { latest?: string };
	description?: string;
};

async function fetchNpm(packageName: string): Promise<ProductPackageMetadata> {
	// Scoped packages keep the leading @ and slash; the npm registry accepts that form.
	const data = await fetchJson<NpmResponse>(`https://registry.npmjs.org/${packageName}`);
	return {
		name: data.name,
		version: data['dist-tags']?.latest ?? '',
		summary: data.description ?? ''
	};
}

type VscodeStatistic = {
	statisticName: string;
	value: number;
};
type VscodeExtension = {
	extensionName: string;
	displayName?: string;
	shortDescription?: string;
	versions: { version: string }[];
	statistics?: VscodeStatistic[];
};
type VscodeQueryResponse = {
	results: { extensions: VscodeExtension[] }[];
};

async function fetchVscode(itemName: string): Promise<ProductPackageMetadata> {
	const data = await fetchJson<VscodeQueryResponse>(
		'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json;api-version=6.0-preview.1'
			},
			body: JSON.stringify({
				filters: [{ criteria: [{ filterType: 7, value: itemName }] }],
				flags: 914
			})
		}
	);
	const ext = data.results?.[0]?.extensions?.[0];
	if (!ext) throw new Error(`vscode extension ${itemName} not found in response`);
	return {
		name: ext.extensionName,
		version: ext.versions?.[0]?.version ?? '',
		summary: ext.shortDescription ?? ext.displayName ?? ''
	};
}

type OpenVsxResponse = {
	name: string;
	namespace?: string;
	version: string;
	description?: string;
	displayName?: string;
};

async function fetchOpenVsx(publisher: string, extension: string): Promise<ProductPackageMetadata> {
	const data = await fetchJson<OpenVsxResponse>(
		`https://open-vsx.org/api/${encodeURIComponent(publisher)}/${encodeURIComponent(extension)}`
	);
	return {
		name: data.name,
		version: data.version,
		summary: data.description ?? data.displayName ?? ''
	};
}

type FirecrawlResponse = {
	success: boolean;
	data?: { markdown?: string };
	error?: string;
};

async function firecrawlScrape(url: string): Promise<string> {
	if (!env.firecrawl.apiKey) throw new Error('FIRECRAWL_API_KEY not set');
	const data = await fetchJson<FirecrawlResponse>('https://api.firecrawl.dev/v1/scrape', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${env.firecrawl.apiKey}`
		},
		body: JSON.stringify({ url, formats: ['markdown'] })
	});
	if (!data.success || !data.data?.markdown) {
		throw new Error(`firecrawl scrape ${url} failed: ${data.error ?? 'no markdown'}`);
	}
	return data.data.markdown;
}

function stripHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

async function plainFetchScrape(url: string): Promise<string> {
	const res = await fetch(url, {
		headers: { 'User-Agent': 'pulsar-context-builder' }
	});
	if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
	const body = await res.text();
	return stripHtml(body);
}

async function scrapeWebPage(url: string): Promise<string> {
	if (env.firecrawl.apiKey) {
		return firecrawlScrape(url);
	}
	return plainFetchScrape(url);
}

function logWarn(message: string): void {
	console.warn(`[context-builder/product] ${message}`);
}

export async function buildProduct(opts: BuildProductOptions): Promise<ProductContext> {
	const { operator, metadataOnly = false } = opts;
	const groundingUrls = [...operator.groundingUrls];

	if (metadataOnly) {
		return {
			positioning: operator.positioning,
			packages: [],
			groundingUrls
		};
	}

	const classified = groundingUrls.map(classifyUrl);

	const packageResults = await Promise.all(
		classified.map(async (entry): Promise<ProductPackageMetadata | null> => {
			try {
				switch (entry.kind) {
					case 'npm':
						return await fetchNpm(entry.packageName);
					case 'pypi':
						return await fetchPyPI(entry.packageName);
					case 'vscode':
						return await fetchVscode(entry.itemName);
					case 'openvsx':
						return await fetchOpenVsx(entry.publisher, entry.extension);
					default:
						return null;
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logWarn(`package fetch failed for ${entry.original}: ${msg}`);
				return null;
			}
		})
	);

	const siteResults = await Promise.all(
		classified.map(async (entry): Promise<string | null> => {
			if (entry.kind !== 'web') return null;
			try {
				return await scrapeWebPage(entry.original);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logWarn(`site scrape failed for ${entry.original}: ${msg}`);
				return null;
			}
		})
	);

	const packages = packageResults.filter((p): p is ProductPackageMetadata => p !== null);
	const sites = siteResults.filter((s): s is string => s !== null && s.length > 0);
	const scrapedSiteContent = sites.length > 0 ? sites.join('\n\n---\n\n') : undefined;

	return {
		positioning: operator.positioning,
		packages,
		groundingUrls,
		scrapedSiteContent
	};
}
