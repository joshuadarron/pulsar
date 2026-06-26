// Minimal markdown to inline-styled HTML for email and PDF.
// Handles paragraphs, bold, italics, inline code, links, ordered and
// unordered lists. No code fences, blockquotes, tables, or headings.
// Block-level structure in reports comes from view-model blocks, not
// from markdown.

export function escapeHtml(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function renderInline(text: string): string {
	let out = escapeHtml(text);
	out = out.replace(
		/`([^`]+)`/g,
		(_m, code) =>
			`<code style="background:#f3f4f6;padding:1px 5px;border-radius:4px;font-family:ui-monospace,Menlo,monospace;font-size:13px;">${code}</code>`
	);
	out = out.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		(_m, label, href) =>
			`<a href="${href}" style="color:#4f46e5;text-decoration:underline;">${label}</a>`
	);
	out = out.replace(
		/\*\*([^*]+)\*\*/g,
		'<strong style="color:#111827;font-weight:600;">$1</strong>'
	);
	out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
	return out;
}

export function renderMarkdownEmail(input: string): string {
	const lines = input.split(/\r?\n/);
	const out: string[] = [];
	let para: string[] = [];
	let listKind: 'ul' | 'ol' | null = null;

	function flushPara() {
		if (para.length === 0) return;
		out.push(
			`<p style="line-height:1.7;font-size:14px;color:#374151;margin:0 0 12px;">${renderInline(para.join(' '))}</p>`
		);
		para = [];
	}

	function flushList() {
		if (!listKind) return;
		out.push(`</${listKind}>`);
		listKind = null;
	}

	for (const raw of lines) {
		const line = raw;
		const ol = line.match(/^\s*\d+\.\s+(.*)$/);
		const ul = line.match(/^\s*[-*]\s+(.*)$/);
		if (ol) {
			flushPara();
			if (listKind !== 'ol') {
				flushList();
				out.push('<ol style="margin:0 0 12px;padding:0 0 0 20px;">');
				listKind = 'ol';
			}
			out.push(
				`<li style="margin-bottom:6px;line-height:1.6;font-size:14px;color:#374151;">${renderInline(ol[1])}</li>`
			);
			continue;
		}
		if (ul) {
			flushPara();
			if (listKind !== 'ul') {
				flushList();
				out.push('<ul style="margin:0 0 12px;padding:0 0 0 20px;">');
				listKind = 'ul';
			}
			out.push(
				`<li style="margin-bottom:6px;line-height:1.6;font-size:14px;color:#374151;">${renderInline(ul[1])}</li>`
			);
			continue;
		}
		if (line.trim() === '') {
			flushPara();
			flushList();
			continue;
		}
		para.push(line.trim());
	}

	flushPara();
	flushList();
	return out.join('\n');
}
