// View registry: maps view IDs declared in app.config.ts to their builder
// functions. The /api/v1/views/<viewId> route uses this to serve view-model
// JSON to remote shells (RocketRide, mobile, future hosts).

import {
	buildArticlesListView,
	buildArticlesViewerView,
	buildDraftsListView,
	buildReportView
} from '@pulsar/app-market-analysis/views';
import { query } from '@pulsar/shared/db/postgres';
import type { ReportData } from '@pulsar/shared/types';
import type { ViewModel } from '@pulsar/view-model';

export type ViewResolution =
	| { ok: true; vm: ViewModel }
	| { ok: false; status: 404 | 400; error: string };

type Resolver = (param: string | undefined) => Promise<ViewResolution>;

const REGISTRY: Record<string, Resolver> = {
	'market-analysis.report': async (id) => {
		if (!id) return { ok: false, status: 400, error: 'Missing report id.' };
		const result = await query<{ report_data: ReportData; generated_at: string }>(
			'SELECT report_data, generated_at FROM reports WHERE id = $1',
			[id]
		);
		if (result.rows.length === 0) return { ok: false, status: 404, error: 'Report not found.' };
		const vm = buildReportView(result.rows[0].report_data, {
			reportId: id,
			generatedAt: result.rows[0].generated_at
		});
		return { ok: true, vm };
	},
	'market-analysis.drafts.list': async () => ({ ok: true, vm: await buildDraftsListView() }),
	'market-analysis.articles.list': async () => ({ ok: true, vm: await buildArticlesListView() }),
	'market-analysis.articles.viewer': async (reportId) => {
		if (!reportId) return { ok: false, status: 400, error: 'Missing report id.' };
		const vm = await buildArticlesViewerView(reportId);
		if (!vm) return { ok: false, status: 404, error: 'Report not found.' };
		return { ok: true, vm };
	}
};

export function listRegisteredViews(): string[] {
	return Object.keys(REGISTRY);
}

export async function resolveView(viewId: string, param?: string): Promise<ViewResolution> {
	const resolver = REGISTRY[viewId];
	if (!resolver) return { ok: false, status: 404, error: `Unknown view: ${viewId}` };
	return resolver(param);
}
