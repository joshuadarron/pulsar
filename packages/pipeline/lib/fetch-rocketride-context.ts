import { env } from '@pulsar/shared/config/env';
import { logRun } from '@pulsar/shared/run-logger';

export interface RocketRideContext {
	packages: {
		pypi: { name: string; version: string; summary: string; homepage: string } | null;
		npm: { name: string; version: string; description: string } | null;
		vscode: { id: string; version: string; installs: number; rating: number } | null;
		openvsx: { id: string; version: string; downloads: number } | null;
	};
	sites: {
		marketing: string | null;
		docs_index: string | null;
		github_readme: string | null;
		founder_article: string | null;
	};
	fetched_at: string;
}

const FOUNDER_ARTICLE_URL =
	'https://medium.com/@joshuadarron/the-full-stack-is-one-layer-deeper-youve-been-building-it-0be0ae1d0fdf';
const GITHUB_REPO = 'rocketride-org/rocketride-server';

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> {
	let lastErr: unknown;
	for (let i = 1; i <= attempts; i++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			if (i < attempts) {
				const wait = delayMs * 2 ** (i - 1);
				await new Promise((r) => setTimeout(r, wait));
			}
		}
	}
	throw lastErr;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
	return res.json() as Promise<T>;
}

interface PyPIResponse {
	info: {
		name: string;
		version: string;
		summary: string;
		home_page?: string;
		project_url?: string;
	};
}

async function fetchPyPI(): Promise<RocketRideContext['packages']['pypi']> {
	const data = await fetchJson<PyPIResponse>('https://pypi.org/pypi/rocketride/json');
	return {
		name: data.info.name,
		version: data.info.version,
		summary: data.info.summary ?? '',
		homepage: data.info.home_page ?? data.info.project_url ?? ''
	};
}

interface NpmResponse {
	name: string;
	'dist-tags': { latest: string };
	description?: string;
}

async function fetchNpm(): Promise<RocketRideContext['packages']['npm']> {
	const data = await fetchJson<NpmResponse>('https://registry.npmjs.org/rocketride');
	return {
		name: data.name,
		version: data['dist-tags']?.latest ?? '',
		description: data.description ?? ''
	};
}

interface VscodeStatistic {
	statisticName: string;
	value: number;
}
interface VscodeExtension {
	extensionName: string;
	versions: { version: string }[];
	statistics: VscodeStatistic[];
}
interface VscodeQueryResponse {
	results: { extensions: VscodeExtension[] }[];
}

async function fetchVscode(): Promise<RocketRideContext['packages']['vscode']> {
	const data = await fetchJson<VscodeQueryResponse>(
		'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json;api-version=6.0-preview.1'
			},
			body: JSON.stringify({
				filters: [{ criteria: [{ filterType: 7, value: 'RocketRide.rocketride' }] }],
				flags: 914
			})
		}
	);
	const ext = data.results?.[0]?.extensions?.[0];
	if (!ext) throw new Error('vscode extension not found in response');
	const installs = ext.statistics?.find((s) => s.statisticName === 'install')?.value ?? 0;
	const rating = ext.statistics?.find((s) => s.statisticName === 'averagerating')?.value ?? 0;
	return {
		id: ext.extensionName,
		version: ext.versions?.[0]?.version ?? '',
		installs,
		rating
	};
}

interface OpenVsxResponse {
	name: string;
	version: string;
	downloadCount?: number;
}

async function fetchOpenVsx(): Promise<RocketRideContext['packages']['openvsx']> {
	const data = await fetchJson<OpenVsxResponse>('https://open-vsx.org/api/RocketRide/rocketride');
	return {
		id: data.name,
		version: data.version,
		downloads: data.downloadCount ?? 0
	};
}

interface FirecrawlResponse {
	success: boolean;
	data?: { markdown?: string };
	error?: string;
}

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

async function fetchGithubReadme(): Promise<string> {
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github.raw',
		'User-Agent': 'pulsar-pipeline'
	};
	if (env.github.token) headers.Authorization = `Bearer ${env.github.token}`;
	const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/readme`, { headers });
	if (!res.ok) throw new Error(`github readme -> HTTP ${res.status}`);
	return res.text();
}

async function tolerant<T>(
	name: string,
	fn: () => Promise<T>,
	runId: string | undefined
): Promise<T | null> {
	try {
		return await withRetry(fn);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (runId) {
			await logRun(runId, 'warn', 'context-fetch', `${name} failed: ${msg}`);
		} else {
			console.warn(`[context-fetch] ${name} failed: ${msg}`);
		}
		return null;
	}
}

export async function fetchRocketRideContext(runId?: string): Promise<RocketRideContext | null> {
	try {
		const [pypi, npm, vscode, openvsx, marketing, docs_index, github_readme, founder_article] =
			await Promise.all([
				tolerant('pypi', fetchPyPI, runId),
				tolerant('npm', fetchNpm, runId),
				tolerant('vscode', fetchVscode, runId),
				tolerant('openvsx', fetchOpenVsx, runId),
				tolerant('firecrawl:marketing', () => firecrawlScrape('https://rocketride.ai'), runId),
				tolerant('firecrawl:docs', () => firecrawlScrape('https://docs.rocketride.org'), runId),
				tolerant('github:readme', fetchGithubReadme, runId),
				tolerant('firecrawl:article', () => firecrawlScrape(FOUNDER_ARTICLE_URL), runId)
			]);

		return {
			packages: { pypi, npm, vscode, openvsx },
			sites: { marketing, docs_index, github_readme, founder_article },
			fetched_at: new Date().toISOString()
		};
	} catch (err) {
		console.error('[fetch-rocketride-context] unexpected failure:', err);
		if (runId) {
			const msg = err instanceof Error ? err.message : String(err);
			await logRun(runId, 'warn', 'context-fetch', `fetchRocketRideContext threw: ${msg}`);
		}
		return null;
	}
}
