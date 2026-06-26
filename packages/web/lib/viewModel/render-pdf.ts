// Render a view-model to a print-ready PDF buffer via Puppeteer.
// Walks the same block tree as render-email but wraps the output in a
// print-targeted document shell.

import type { ViewModel } from '@pulsar/view-model';
import { escapeHtml } from './markdown.js';
import { renderViewModelEmail } from './render-email.js';

export type RenderViewModelPdfOptions = {
	header?: string;
	footer?: string;
	format?: 'A4' | 'Letter';
};

export async function renderViewModelPdf(
	vm: ViewModel,
	opts: RenderViewModelPdfOptions = {}
): Promise<Buffer> {
	const body = renderViewModelEmail(vm, { header: opts.header, footer: opts.footer });

	const fullHtml = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${escapeHtml(vm.title ?? vm.view)}</title>
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

	try {
		const page = await browser.newPage();
		await page.setContent(fullHtml, { waitUntil: 'load' });
		const pdf = await page.pdf({
			format: opts.format ?? 'A4',
			printBackground: true,
			margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
		});
		return Buffer.from(pdf);
	} finally {
		await browser.close();
	}
}
