// Pulsar-branded chrome wrappers for the email and PDF rendering paths.
// The view-model itself is operator-agnostic; the chrome (header banner,
// footer, CTA links) is added by this shell. Color values mirror the
// light-mode token palette in app/globals.css (email has no dark mode).

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
	return `<div style="background:linear-gradient(135deg, #7c3aed 0%, #6927d8 100%);padding:28px 24px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between;gap:16px;">
<div>
<h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.01em;">Pulsar: ${escapeHtml(opts.title)}</h1>
<p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px;font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(date)}</p>
</div>
</div>`;
}

export function buildPulsarEmailFooter(opts: PulsarEmailChromeOptions): string {
	const links: string[] = [];
	if (opts.reportUrl) {
		links.push(
			`<a href="${opts.reportUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-right:8px;">View Full Report</a>`
		);
	}
	if (opts.pdfUrl) {
		links.push(
			`<a href="${opts.pdfUrl}" style="display:inline-block;background:#e8e7e1;color:#0a0a0a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-right:8px;border:1px solid rgba(0,0,0,0.08);">Download PDF</a>`
		);
	}
	if (opts.evalsUrl) {
		links.push(
			`<a href="${opts.evalsUrl}" style="display:inline-block;background:#e8e7e1;color:#0a0a0a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;border:1px solid rgba(0,0,0,0.08);">View Scores</a>`
		);
	}
	if (links.length === 0) return '';
	return `<div style="padding:16px 24px 28px;text-align:center;">${links.join('')}</div>`;
}

export function buildPulsarEmailDocument(body: string): string {
	return `<!DOCTYPE html>
<html>
<body style="font-family:'Instrument Sans','Instrument Sans Variable',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#0a0a0a;background:#f0efe9;">
<div style="background:#e8e7e1;border:1px solid rgba(0,0,0,0.08);border-radius:12px;overflow:hidden;">
${body}
</div>
<p style="text-align:center;color:rgba(10,10,10,0.42);font-size:12px;font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:0.08em;margin-top:24px;">Pulsar, Automated Market Intelligence</p>
</body>
</html>`;
}
