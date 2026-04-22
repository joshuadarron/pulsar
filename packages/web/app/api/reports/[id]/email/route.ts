import { NextResponse } from 'next/server';
import { createElement } from 'react';
import { query } from '@pulsar/shared/db/postgres';
import { env } from '@pulsar/shared/config/env';
import type { ReportData } from '@pulsar/shared/types';
import ReportTemplate from '@/components/report/ReportTemplate';

export const dynamic = 'force-dynamic';

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;

	const result = await query<{ report_data: ReportData; generated_at: string }>(
		'SELECT report_data, generated_at FROM reports WHERE id = $1',
		[id],
	);

	if (result.rows.length === 0) {
		return NextResponse.json({ error: 'Report not found' }, { status: 404 });
	}

	const reportData = result.rows[0].report_data;
	const generatedAt = result.rows[0].generated_at;
	const reportUrl = `${env.nextauth.url}/reports/${id}`;
	const pdfUrl = `${env.nextauth.url}/api/reports/${id}/export/pdf`;

	// Dynamic import avoids Next.js static-analysis block on react-dom/server in route handlers
	const { renderToStaticMarkup } = await import('react-dom/server');

	const body = renderToStaticMarkup(
		createElement(ReportTemplate, {
			data: reportData,
			variant: 'email',
			reportId: id,
			generatedAt,
			reportUrl,
			pdfUrl,
		}),
	);

	const html = `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; color: #1a1a1a; background: #f9fafb;">
	<div style="background: white; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
		${body}
	</div>
	<p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 24px;">
		Pulsar — Automated Market Intelligence
	</p>
</body>
</html>`;

	return new NextResponse(html, {
		headers: { 'Content-Type': 'text/html; charset=utf-8' },
	});
}
