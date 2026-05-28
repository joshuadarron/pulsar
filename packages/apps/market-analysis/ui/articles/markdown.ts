// Minimal markdown to HTML converter for the in-page article preview.
// Handles headings, bold, italics, inline code, links, fenced code blocks,
// blockquotes, ordered and unordered lists, tables, and paragraphs.
// The markdown source the operator copies is the source of truth; visual
// fidelity here matters less than structure.

function escapeHtml(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function renderInline(text: string): string {
	let escaped = escapeHtml(text);
	escaped = escaped.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
	escaped = escaped.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		(_m, label, href) =>
			`<a href="${href}" class="text-indigo-600 underline" rel="noreferrer noopener">${label}</a>`
	);
	escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	escaped = escaped.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
	return escaped;
}

export function renderMarkdown(input: string): string {
	const lines = input.split(/\r?\n/);
	const out: string[] = [];
	let inCode = false;
	let codeBuffer: string[] = [];
	let listType: 'ul' | 'ol' | null = null;
	let paragraphBuffer: string[] = [];
	let quoteBuffer: string[] = [];
	let tableHeader: string[] | null = null;
	let tableRows: string[][] = [];

	function flushParagraph() {
		if (paragraphBuffer.length === 0) return;
		out.push(`<p class="my-3 leading-relaxed">${renderInline(paragraphBuffer.join(' '))}</p>`);
		paragraphBuffer = [];
	}

	function flushList() {
		if (!listType) return;
		out.push(`</${listType}>`);
		listType = null;
	}

	function flushQuote() {
		if (quoteBuffer.length === 0) return;
		out.push(
			`<blockquote class="my-4 border-l-4 border-indigo-400 pl-4 italic text-gray-700 dark:text-neutral-300">${renderInline(quoteBuffer.join(' '))}</blockquote>`
		);
		quoteBuffer = [];
	}

	function flushTable() {
		if (!tableHeader) return;
		const head = tableHeader
			.map((cell) => `<th class="px-3 py-1.5 text-left font-medium">${renderInline(cell)}</th>`)
			.join('');
		const body = tableRows
			.map(
				(row) =>
					`<tr>${row.map((cell) => `<td class="px-3 py-1.5">${renderInline(cell)}</td>`).join('')}</tr>`
			)
			.join('');
		out.push(
			`<div class="my-4 overflow-x-auto"><table class="min-w-full text-sm border border-gray-200 dark:border-neutral-700"><thead class="bg-gray-50 dark:bg-neutral-800"><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
		);
		tableHeader = null;
		tableRows = [];
	}

	function flushAll() {
		flushParagraph();
		flushList();
		flushQuote();
		flushTable();
	}

	function parseTableRow(line: string): string[] {
		return line
			.replace(/^\||\|$/g, '')
			.split('|')
			.map((cell) => cell.trim());
	}

	for (const rawLine of lines) {
		const line = rawLine;
		const fence = line.match(/^```(\w*)\s*$/);
		if (fence) {
			if (inCode) {
				out.push(
					`<pre class="overflow-x-auto rounded bg-gray-100 dark:bg-neutral-900 p-3 text-xs font-mono"><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`
				);
				codeBuffer = [];
				inCode = false;
			} else {
				flushAll();
				inCode = true;
			}
			continue;
		}
		if (inCode) {
			codeBuffer.push(line);
			continue;
		}
		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			flushAll();
			const level = heading[1].length;
			const size = level === 1 ? 'text-2xl' : level === 2 ? 'text-xl' : 'text-lg';
			out.push(
				`<h${level} class="${size} font-semibold mt-5 mb-2">${renderInline(heading[2])}</h${level}>`
			);
			continue;
		}
		const blockquote = line.match(/^\s*>\s?(.*)$/);
		if (blockquote) {
			flushParagraph();
			flushList();
			flushTable();
			quoteBuffer.push(blockquote[1]);
			continue;
		}
		const ol = line.match(/^\s*\d+\.\s+(.*)$/);
		const ul = line.match(/^\s*[-*]\s+(.*)$/);
		if (ol) {
			flushParagraph();
			flushQuote();
			flushTable();
			if (listType !== 'ol') {
				flushList();
				out.push('<ol class="list-decimal pl-6 space-y-1 my-3">');
				listType = 'ol';
			}
			out.push(`<li>${renderInline(ol[1])}</li>`);
			continue;
		}
		if (ul) {
			flushParagraph();
			flushQuote();
			flushTable();
			if (listType !== 'ul') {
				flushList();
				out.push('<ul class="list-disc pl-6 space-y-1 my-3">');
				listType = 'ul';
			}
			out.push(`<li>${renderInline(ul[1])}</li>`);
			continue;
		}
		const tableRow = line.match(/^\s*\|.*\|\s*$/);
		const tableSeparator = line.match(/^\s*\|?\s*[:-]+(\s*\|\s*[:-]+)+\s*\|?\s*$/);
		if (tableRow && !tableSeparator) {
			const cells = parseTableRow(line.trim());
			if (!tableHeader) {
				flushParagraph();
				flushList();
				flushQuote();
				tableHeader = cells;
			} else {
				tableRows.push(cells);
			}
			continue;
		}
		if (tableSeparator) {
			continue;
		}
		if (line.trim() === '') {
			flushAll();
			continue;
		}
		flushQuote();
		flushTable();
		paragraphBuffer.push(line.trim());
	}

	flushAll();
	return out.join('\n');
}
