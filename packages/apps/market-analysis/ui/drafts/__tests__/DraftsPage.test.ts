import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import { type ReactElement, type ReactNode, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

interface QueryCall {
	sql: string;
	params: unknown[];
}

const queryCalls: QueryCall[] = [];

let nextResponses: Array<Array<Record<string, unknown>>> = [];

const mockQuery = mock.fn(async (sql: string, params?: unknown[]) => {
	queryCalls.push({ sql, params: params ?? [] });
	const rows = nextResponses.shift() ?? [];
	return { rows };
});

mock.module('@pulsar/shared/db/postgres', {
	namedExports: { query: mockQuery }
});

mock.module('next/link', {
	defaultExport: ({
		href,
		children,
		className
	}: {
		href: string;
		children: ReactNode;
		className?: string;
	}) => createElement('a', { href, className }, children)
});

const { default: DraftsPage } = await import('../DraftsPage.js');

function resetMocks() {
	queryCalls.length = 0;
	mockQuery.mock.resetCalls();
	nextResponses = [];
}

async function renderPage(): Promise<string> {
	const node = (await DraftsPage()) as ReactElement;
	return renderToStaticMarkup(node);
}

describe('DraftsPage server component', () => {
	beforeEach(() => {
		resetMocks();
	});

	describe('empty state', () => {
		it('renders the empty state and the trigger command when no drafts exist', async () => {
			nextResponses = [[]];
			const html = await renderPage();
			assert.match(html, /No drafts yet/);
			assert.match(html, /pnpm run pipeline -- --content-only --report-id=/);
		});

		it('issues a single grouped SQL query', async () => {
			nextResponses = [[]];
			await renderPage();
			assert.equal(queryCalls.length, 1);
			assert.match(queryCalls[0].sql, /FROM reports/);
			assert.match(queryCalls[0].sql, /JOIN content_drafts/);
		});
	});

	describe('single group', () => {
		it('renders the report card with top opportunity and draft count', async () => {
			nextResponses = [
				[
					{
						report_id: 'r1',
						generated_at: new Date('2026-04-15T10:00:00Z'),
						top_meaning: 'MCP is moving from spec to load-bearing dependency.',
						draft_count: '6',
						platform_count: '3'
					}
				]
			];
			const html = await renderPage();
			assert.match(html, /MCP is moving from spec to load-bearing dependency/);
			assert.match(html, /6 drafts across 3 platforms/);
			assert.match(html, /href="\/drafts\/r1"/);
		});

		it('falls back to a placeholder when the report has no interpretations', async () => {
			nextResponses = [
				[
					{
						report_id: 'r1',
						generated_at: new Date('2026-04-15T10:00:00Z'),
						top_meaning: null,
						draft_count: '1',
						platform_count: '1'
					}
				]
			];
			const html = await renderPage();
			assert.match(html, /No interpretations available/);
			assert.match(html, /1 draft across 1 platform/);
		});
	});

	describe('multiple groups', () => {
		it('renders one card per report group, in DB order', async () => {
			nextResponses = [
				[
					{
						report_id: 'r1',
						generated_at: new Date('2026-04-15T10:00:00Z'),
						top_meaning: 'First report meaning',
						draft_count: '3',
						platform_count: '2'
					},
					{
						report_id: 'r2',
						generated_at: new Date('2026-04-08T10:00:00Z'),
						top_meaning: 'Second report meaning',
						draft_count: '4',
						platform_count: '4'
					}
				]
			];
			const html = await renderPage();
			assert.match(html, /First report meaning/);
			assert.match(html, /Second report meaning/);
			assert.match(html, /href="\/drafts\/r1"/);
			assert.match(html, /href="\/drafts\/r2"/);
			const firstIdx = html.indexOf('First report meaning');
			const secondIdx = html.indexOf('Second report meaning');
			assert.ok(firstIdx >= 0);
			assert.ok(secondIdx > firstIdx);
		});
	});
});
