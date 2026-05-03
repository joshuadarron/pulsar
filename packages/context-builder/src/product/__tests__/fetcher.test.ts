import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import type { OperatorContext } from '@pulsar/context';

const envState = {
	firecrawl: { apiKey: '' }
};

mock.module('@pulsar/shared/config/env', {
	namedExports: {
		env: envState
	}
});

const { buildProduct } = await import('../fetcher.js');

type FetchCall = { url: string; init?: RequestInit };

let fetchCalls: FetchCall[] = [];
let fetchHandler: ((url: string, init?: RequestInit) => Response | Promise<Response>) | null = null;
const realFetch = globalThis.fetch;

function installFetchStub(): void {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		fetchCalls.push({ url, init });
		if (!fetchHandler) throw new Error(`Unexpected fetch call: ${url}`);
		return fetchHandler(url, init);
	}) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function htmlResponse(body: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: { 'Content-Type': 'text/html' }
	});
}

function makeOperator(overrides: Partial<OperatorContext> = {}): OperatorContext {
	return {
		operatorName: 'Jane Doe',
		role: 'Founder',
		orgName: 'Acme Corp',
		domain: 'market-analysis',
		allowedGitHubLogins: [],
		groundingUrls: [],
		positioning: 'Acme Corp builds reliable backend tooling.',
		audience: 'Senior backend engineers',
		hardRules: [],
		glossary: {},
		trackedEntities: { entities: [], keywords: [], technologies: [] },
		...overrides
	};
}

beforeEach(() => {
	fetchCalls = [];
	fetchHandler = null;
	envState.firecrawl.apiKey = '';
	installFetchStub();
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('buildProduct', () => {
	describe('npm classification', () => {
		it('fetches npm registry and returns package metadata', async () => {
			fetchHandler = (url) => {
				assert.equal(url, 'https://registry.npmjs.org/acme-runtime');
				return jsonResponse({
					name: 'acme-runtime',
					'dist-tags': { latest: '1.2.3' },
					description: 'Acme runtime package'
				});
			};

			const ctx = await buildProduct({
				operator: makeOperator({
					groundingUrls: ['https://www.npmjs.com/package/acme-runtime']
				})
			});

			assert.equal(ctx.positioning, 'Acme Corp builds reliable backend tooling.');
			assert.deepEqual(ctx.packages, [
				{ name: 'acme-runtime', version: '1.2.3', summary: 'Acme runtime package' }
			]);
			assert.deepEqual(ctx.groundingUrls, ['https://www.npmjs.com/package/acme-runtime']);
			assert.equal(ctx.scrapedSiteContent, undefined);
		});

		it('handles scoped npm packages', async () => {
			fetchHandler = (url) => {
				assert.equal(url, 'https://registry.npmjs.org/@acme/core');
				return jsonResponse({
					name: '@acme/core',
					'dist-tags': { latest: '0.4.0' },
					description: 'Acme core'
				});
			};

			const ctx = await buildProduct({
				operator: makeOperator({
					groundingUrls: ['https://www.npmjs.com/package/@acme/core']
				})
			});

			assert.equal(ctx.packages[0]?.name, '@acme/core');
			assert.equal(ctx.packages[0]?.version, '0.4.0');
		});
	});

	describe('PyPI classification', () => {
		it('fetches PyPI JSON and returns package metadata', async () => {
			fetchHandler = (url) => {
				assert.equal(url, 'https://pypi.org/pypi/acme-sdk/json');
				return jsonResponse({
					info: { name: 'acme-sdk', version: '2.0.1', summary: 'Acme Python SDK' }
				});
			};

			const ctx = await buildProduct({
				operator: makeOperator({
					groundingUrls: ['https://pypi.org/project/acme-sdk/']
				})
			});

			assert.deepEqual(ctx.packages, [
				{ name: 'acme-sdk', version: '2.0.1', summary: 'Acme Python SDK' }
			]);
		});
	});

	describe('VS Code marketplace classification', () => {
		it('queries the marketplace API and returns package metadata', async () => {
			fetchHandler = (url, init) => {
				assert.equal(
					url,
					'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery'
				);
				assert.equal(init?.method, 'POST');
				const body = JSON.parse(init?.body as string);
				assert.equal(body.filters[0].criteria[0].value, 'AcmePub.acme-vscode');
				return jsonResponse({
					results: [
						{
							extensions: [
								{
									extensionName: 'acme-vscode',
									versions: [{ version: '0.9.0' }],
									shortDescription: 'Acme VS Code extension',
									statistics: [{ statisticName: 'install', value: 1234 }]
								}
							]
						}
					]
				});
			};

			const ctx = await buildProduct({
				operator: makeOperator({
					groundingUrls: ['https://marketplace.visualstudio.com/items?itemName=AcmePub.acme-vscode']
				})
			});

			assert.deepEqual(ctx.packages, [
				{ name: 'acme-vscode', version: '0.9.0', summary: 'Acme VS Code extension' }
			]);
		});
	});

	describe('OpenVSX classification', () => {
		it('queries the OpenVSX API and returns package metadata', async () => {
			fetchHandler = (url) => {
				assert.equal(url, 'https://open-vsx.org/api/AcmePub/acme-vscode');
				return jsonResponse({
					name: 'acme-vscode',
					namespace: 'AcmePub',
					version: '0.9.0',
					description: 'Acme OpenVSX extension'
				});
			};

			const ctx = await buildProduct({
				operator: makeOperator({
					groundingUrls: ['https://open-vsx.org/extension/AcmePub/acme-vscode']
				})
			});

			assert.deepEqual(ctx.packages, [
				{ name: 'acme-vscode', version: '0.9.0', summary: 'Acme OpenVSX extension' }
			]);
		});
	});

	describe('generic web URL', () => {
		it('uses Firecrawl when API key is set', async () => {
			envState.firecrawl.apiKey = 'fc-test-key';
			fetchHandler = (url, init) => {
				assert.equal(url, 'https://api.firecrawl.dev/v1/scrape');
				const headers = init?.headers as Record<string, string>;
				assert.equal(headers.Authorization, 'Bearer fc-test-key');
				const body = JSON.parse(init?.body as string);
				assert.equal(body.url, 'https://acme.example.com');
				return jsonResponse({
					success: true,
					data: { markdown: '# Acme Marketing Page' }
				});
			};

			const ctx = await buildProduct({
				operator: makeOperator({
					groundingUrls: ['https://acme.example.com']
				})
			});

			assert.equal(ctx.packages.length, 0);
			assert.equal(ctx.scrapedSiteContent, '# Acme Marketing Page');
		});

		it('falls back to plain fetch + HTML strip when Firecrawl key is not set', async () => {
			envState.firecrawl.apiKey = '';
			fetchHandler = (url) => {
				assert.equal(url, 'https://acme.example.com/');
				return htmlResponse(
					'<html><head><title>Acme</title><style>.x{}</style></head><body><h1>Acme</h1><p>Reliable backend tooling.</p><script>var x=1;</script></body></html>'
				);
			};

			const ctx = await buildProduct({
				operator: makeOperator({
					groundingUrls: ['https://acme.example.com/']
				})
			});

			assert.equal(ctx.packages.length, 0);
			assert.ok(ctx.scrapedSiteContent);
			assert.match(ctx.scrapedSiteContent ?? '', /Reliable backend tooling/);
			assert.doesNotMatch(ctx.scrapedSiteContent ?? '', /<script>/);
			assert.doesNotMatch(ctx.scrapedSiteContent ?? '', /var x=1/);
		});
	});

	describe('graceful degradation', () => {
		it('continues when one URL fails', async () => {
			fetchHandler = (url) => {
				if (url === 'https://registry.npmjs.org/acme-runtime') {
					return new Response('boom', { status: 500 });
				}
				if (url === 'https://pypi.org/pypi/acme-sdk/json') {
					return jsonResponse({
						info: { name: 'acme-sdk', version: '2.0.1', summary: 'Acme Python SDK' }
					});
				}
				throw new Error(`unexpected url ${url}`);
			};

			const ctx = await buildProduct({
				operator: makeOperator({
					groundingUrls: [
						'https://www.npmjs.com/package/acme-runtime',
						'https://pypi.org/project/acme-sdk/'
					]
				})
			});

			assert.equal(ctx.packages.length, 1);
			assert.equal(ctx.packages[0]?.name, 'acme-sdk');
		});

		it('concatenates multiple scraped sites with --- separator', async () => {
			envState.firecrawl.apiKey = 'fc-test-key';
			fetchHandler = (_url, init) => {
				const body = JSON.parse(init?.body as string);
				return jsonResponse({
					success: true,
					data: { markdown: `content from ${body.url}` }
				});
			};

			const ctx = await buildProduct({
				operator: makeOperator({
					groundingUrls: ['https://acme.example.com', 'https://blog.acme.example.com']
				})
			});

			assert.equal(
				ctx.scrapedSiteContent,
				'content from https://acme.example.com\n\n---\n\ncontent from https://blog.acme.example.com'
			);
		});
	});

	describe('metadataOnly mode', () => {
		it('returns positioning and groundingUrls without firing fetches', async () => {
			fetchHandler = () => {
				throw new Error('fetch should not be called in metadataOnly mode');
			};

			const ctx = await buildProduct({
				operator: makeOperator({
					groundingUrls: ['https://www.npmjs.com/package/acme-runtime', 'https://acme.example.com']
				}),
				metadataOnly: true
			});

			assert.equal(fetchCalls.length, 0);
			assert.equal(ctx.positioning, 'Acme Corp builds reliable backend tooling.');
			assert.deepEqual(ctx.packages, []);
			assert.deepEqual(ctx.groundingUrls, [
				'https://www.npmjs.com/package/acme-runtime',
				'https://acme.example.com'
			]);
			assert.equal(ctx.scrapedSiteContent, undefined);
		});
	});
});
