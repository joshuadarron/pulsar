import { buildReportView } from '@pulsar/app-market-analysis/views/reportView';
import { env } from '@pulsar/shared/config/env';
import { query } from '@pulsar/shared/db/postgres';
import type { ReportData } from '@pulsar/shared/types';
import { NextResponse } from 'next/server';
import {
	buildPulsarEmailDocument,
	buildPulsarEmailFooter,
	buildPulsarEmailHeader
} from '@/lib/viewModel/chrome';
import { renderViewModelEmail } from '@/lib/viewModel/render-email';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;

	const result = await query<{ report_data: ReportData; generated_at: string }>(
		'SELECT report_data, generated_at FROM reports WHERE id = $1',
		[id]
	);

	if (result.rows.length === 0) {
		return NextResponse.json({ error: 'Report not found' }, { status: 404 });
	}

	const { report_data, generated_at } = result.rows[0];
	const reportUrl = `${env.nextauth.url}/reports/${id}`;
	const pdfUrl = `${env.nextauth.url}/api/reports/${id}/export/pdf`;

	const vm = buildReportView(report_data, { reportId: id, generatedAt: generated_at });
	const chromeOpts = {
		title: vm.title ?? 'Market Analysis Report',
		generatedAt: generated_at,
		reportUrl,
		pdfUrl
	};

	const body = renderViewModelEmail(vm, {
		header: buildPulsarEmailHeader(chromeOpts),
		footer: buildPulsarEmailFooter(chromeOpts)
	});

	return new NextResponse(buildPulsarEmailDocument(body), {
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});
}
