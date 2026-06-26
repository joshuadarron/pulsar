// Pulsar-branded chrome wrappers for the email and PDF rendering paths.
// The view-model itself is operator-agnostic; the chrome (gradient header
// banner, footer, CTA links) is added by this shell.

import { escapeHtml } from './markdown.js';

export type PulsarEmailChromeOptions = {
	title: string;
	generatedAt?: string;
	reportUrl?: string;
	pdfUrl?: string;
	evalsUrl?: string;
};

function formatDate(iso?: string): string {
	const d = iso ? new Date(iso) : new Date();
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric'
	});
}

export function buildPulsarEmailHeader(opts: PulsarEmailChromeOptions): string {
	const date = formatDate(opts.generatedAt);
	return `<div style="background:linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);padding:28px 24px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between;gap:16px;">
<div>
<h1 style="color:white;margin:0;font-size:24px;font-weight:700;">Pulsar: ${escapeHtml(opts.title)}</h1>
<p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">${escapeHtml(date)}</p>
</div>
</div>`;
}

export function buildPulsarEmailFooter(opts: PulsarEmailChromeOptions): string {
	const links: string[] = [];
	if (opts.reportUrl) {
		links.push(
			`<a href="${opts.reportUrl}" style="display:inline-block;background:#4f46e5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-right:8px;">View Full Report</a>`
		);
	}
	if (opts.pdfUrl) {
		links.push(
			`<a href="${opts.pdfUrl}" style="display:inline-block;background:#f3f4f6;color:#374151;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-right:8px;">Download PDF</a>`
		);
	}
	if (opts.evalsUrl) {
		links.push(
			`<a href="${opts.evalsUrl}" style="display:inline-block;background:#f3f4f6;color:#374151;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">View Scores</a>`
		);
	}
	if (links.length === 0) return '';
	return `<div style="padding:16px 24px 28px;text-align:center;">${links.join('')}</div>`;
}

export function buildPulsarEmailDocument(body: string): string {
	return `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#1a1a1a;background:#f9fafb;">
<div style="background:white;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
${body}
</div>
<p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:24px;">Pulsar, Automated Market Intelligence</p>
</body>
</html>`;
}
