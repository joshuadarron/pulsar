import { buildReportView } from '@pulsar/app-market-analysis/views/reportView';
import { query } from '@pulsar/shared/db/postgres';
import type { ReportData } from '@pulsar/shared/types';
import { NextResponse } from 'next/server';
import { buildPulsarEmailHeader } from '@/lib/viewModel/chrome';
import { renderViewModelPdf } from '@/lib/viewModel/render-pdf';

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
	const vm = buildReportView(report_data, { reportId: id, generatedAt: generated_at });
	const header = buildPulsarEmailHeader({
		title: vm.title ?? 'Market Analysis Report',
		generatedAt: generated_at
	});

	try {
		const pdf = await renderViewModelPdf(vm, { header });
		return new NextResponse(new Uint8Array(pdf), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="pulsar-report-${id}.pdf"`
			}
		});
	} catch (err) {
		console.error('PDF generation failed:', err);
		return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
	}
}
