import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReportTemplate from '@pulsar/web/report-template';
import type { ReportData } from '@pulsar/shared/types';

export function renderReportEmail(
	data: ReportData,
	reportId: string,
	generatedAt: string,
	reportUrl: string,
	pdfUrl: string,
): string {
	const body = renderToStaticMarkup(
		createElement(ReportTemplate, {
			data,
			variant: 'email',
			reportId,
			generatedAt,
			reportUrl,
			pdfUrl,
		}),
	);

	return `<!DOCTYPE html>
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
}
