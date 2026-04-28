import { NextResponse } from 'next/server';
import { createElement } from 'react';
import { query } from '@pulsar/shared/db/postgres';
import type { ReportData } from '@pulsar/shared/types';
import ReportTemplate from '@/components/report/ReportTemplate';

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

	try {
		const { renderToStaticMarkup } = await import('react-dom/server');

		const body = renderToStaticMarkup(
			createElement(ReportTemplate, {
				data: report_data,
				variant: 'email',
				reportId: id,
				generatedAt: generated_at
			})
		);

		const fullHtml = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           color: #111827; background: #fff; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
    .no-print { display: none !important; }
  </style>
</head><body>${body}</body></html>`;

		const puppeteer = await import('puppeteer');
		const browser = await puppeteer.default.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox']
		});

		const page = await browser.newPage();
		await page.setContent(fullHtml, { waitUntil: 'load' });

		const pdf = await page.pdf({
			format: 'A4',
			printBackground: true,
			margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
		});

		await browser.close();

		return new NextResponse(Buffer.from(pdf), {
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
