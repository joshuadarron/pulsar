// String-based renderer that walks a ViewModel block tree and emits
// inline-styled HTML suitable for email or Puppeteer-driven PDF. No React,
// no JSX. Shells render the same view-model with their own primitives.

import type {
	BadgeBlock,
	Block,
	CardBlock,
	ChartBlock,
	DividerBlock,
	EmptyStateBlock,
	GraphBlock,
	HeadingBlock,
	KpiGridBlock,
	LinkBlock,
	ListBlock,
	MarkdownBlock,
	RawHtmlBlock,
	SectionBlock,
	TabsBlock,
	TableBlock,
	TextBlock,
	Tone,
	ViewModel
} from '@pulsar/view-model';
import { type LineSeries, renderLineSvg } from '../charts/line-svg.js';
import { type PieSlice, renderPieSvg } from '../charts/pie-svg.js';
import { escapeHtml, renderMarkdownEmail } from './markdown.js';

const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
	neutral: { bg: '#f3f4f6', fg: '#374151' },
	positive: { bg: '#dcfce7', fg: '#166534' },
	negative: { bg: '#fee2e2', fg: '#991b1b' },
	warn: { bg: '#fef3c7', fg: '#92400e' },
	info: { bg: '#e0e7ff', fg: '#3730a3' }
};

export type RenderViewModelEmailOptions = {
	/** Wrap the rendered blocks in an HTML document shell. Defaults to false. */
	document?: boolean;
	/** Optional top banner above the blocks (HTML). */
	header?: string;
	/** Optional footer below the blocks (HTML). */
	footer?: string;
};

export function renderViewModelEmail(
	vm: ViewModel,
	opts: RenderViewModelEmailOptions = {}
): string {
	const body = vm.blocks.map(renderBlock).join('\n');
	const inner = `${opts.header ?? ''}${body}${opts.footer ?? ''}`;

	if (!opts.document) return inner;

	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(vm.title ?? vm.view)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#1a1a1a;background:#f9fafb;">
<div style="background:white;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
${inner}
</div>
</body>
</html>`;
}

export function renderBlock(block: Block): string {
	switch (block.kind) {
		case 'section':
			return renderSection(block);
		case 'heading':
			return renderHeading(block);
		case 'text':
			return renderText(block);
		case 'markdown':
			return renderMarkdown(block);
		case 'card':
			return renderCard(block);
		case 'kpiGrid':
			return renderKpiGrid(block);
		case 'table':
			return renderTable(block);
		case 'chart':
			return renderChart(block);
		case 'list':
			return renderList(block);
		case 'tabs':
			return renderTabs(block);
		case 'graph':
			return renderGraph(block);
		case 'link':
			return renderLink(block);
		case 'badge':
			return renderBadge(block);
		case 'divider':
			return renderDivider(block);
		case 'emptyState':
			return renderEmptyState(block);
		case 'rawHtml':
			return renderRawHtml(block);
	}
}

function renderSection(block: SectionBlock): string {
	const titleHtml = block.title
		? `<h2 style="font-size:18px;font-weight:600;color:#111827;margin:0 0 12px;">${escapeHtml(block.title)}</h2>`
		: '';
	const subtitleHtml = block.subtitle
		? `<p style="font-size:13px;color:#6b7280;margin:-8px 0 12px;">${escapeHtml(block.subtitle)}</p>`
		: '';
	const children = block.blocks.map(renderBlock).join('\n');
	return `<section style="padding:0 24px 24px;">${titleHtml}${subtitleHtml}${children}</section>`;
}

function renderHeading(block: HeadingBlock): string {
	const sizes: Record<HeadingBlock['level'], number> = { 1: 24, 2: 18, 3: 16, 4: 14 };
	const size = sizes[block.level];
	return `<h${block.level} style="font-size:${size}px;font-weight:600;color:#111827;margin:16px 0 8px;">${escapeHtml(block.text)}</h${block.level}>`;
}

function renderText(block: TextBlock): string {
	const colors = { normal: '#374151', muted: '#6b7280', strong: '#111827' };
	const weight = block.emphasis === 'strong' ? 600 : 400;
	return `<p style="line-height:1.7;font-size:14px;color:${colors[block.emphasis ?? 'normal']};font-weight:${weight};margin:0 0 12px;">${escapeHtml(block.body)}</p>`;
}

function renderMarkdown(block: MarkdownBlock): string {
	return renderMarkdownEmail(block.body);
}

function renderCard(block: CardBlock): string {
	const tone = TONE_COLORS[block.tone ?? 'neutral'];
	const valueHtml =
		block.value !== undefined
			? `<div style="font-size:24px;font-weight:700;color:#111827;margin:4px 0;">${escapeHtml(String(block.value))}</div>`
			: '';
	const trendHtml = block.trend
		? `<div style="font-size:12px;color:${TONE_COLORS[block.trend.tone ?? 'neutral'].fg};">${escapeHtml(block.trend.deltaLabel)}</div>`
		: '';
	const footerHtml = block.footer
		? `<div style="font-size:12px;color:#6b7280;margin-top:6px;">${escapeHtml(block.footer)}</div>`
		: '';
	const inner = `<div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(block.title)}</div>${valueHtml}${trendHtml}${footerHtml}`;
	const wrapper = `<div style="border:1px solid #e5e7eb;background:${tone.bg};border-radius:8px;padding:16px;">${inner}</div>`;
	if (block.href) {
		return `<a href="${block.href}" style="display:block;text-decoration:none;color:inherit;">${wrapper}</a>`;
	}
	return wrapper;
}

function renderKpiGrid(block: KpiGridBlock): string {
	const columns = block.columns ?? 4;
	const cellWidth = `${Math.floor(100 / columns)}%`;
	const cells = block.cards
		.map(
			(c) => `<td style="padding:6px;vertical-align:top;width:${cellWidth};">${renderCard(c)}</td>`
		)
		.join('');
	return `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:0 0 12px;"><tr>${cells}</tr></table>`;
}

function renderTable(block: TableBlock): string {
	if (block.rows.length === 0) {
		return `<p style="font-size:13px;color:#6b7280;font-style:italic;">${escapeHtml(block.emptyText ?? 'No data.')}</p>`;
	}
	const head = block.columns
		.map(
			(c) =>
				`<th style="padding:8px 12px;text-align:${c.align ?? 'left'};font-weight:600;font-size:12px;color:#374151;background:#f9fafb;border-bottom:1px solid #e5e7eb;">${escapeHtml(c.label)}</th>`
		)
		.join('');
	const body = block.rows
		.map((row) => {
			const cells = block.columns
				.map((c) => {
					const cell = row.cells[c.key];
					return `<td style="padding:8px 12px;text-align:${c.align ?? 'left'};font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">${renderTableCell(cell)}</td>`;
				})
				.join('');
			return `<tr>${cells}</tr>`;
		})
		.join('');
	return `<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin:0 0 12px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderTableCell(cell: TableBlock['rows'][number]['cells'][string] | undefined): string {
	if (!cell) return '';
	switch (cell.kind) {
		case 'text':
			return escapeHtml(cell.value);
		case 'number':
			return escapeHtml(formatNumber(cell.value, cell.format));
		case 'link':
			return `<a href="${cell.href}" style="color:#4f46e5;text-decoration:underline;">${escapeHtml(cell.label)}</a>`;
		case 'badge': {
			const tone = TONE_COLORS[cell.tone ?? 'neutral'];
			return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:${tone.bg};color:${tone.fg};font-size:11px;font-weight:500;">${escapeHtml(cell.label)}</span>`;
		}
		case 'date':
			return escapeHtml(formatDate(cell.iso, cell.format));
	}
}

function formatNumber(n: number, fmt?: 'integer' | 'percent' | 'decimal'): string {
	if (fmt === 'percent') return `${Math.round(n * 100)}%`;
	if (fmt === 'integer') return Math.round(n).toLocaleString();
	if (fmt === 'decimal') return n.toFixed(2);
	return String(n);
}

function formatDate(iso: string, fmt?: 'date' | 'datetime' | 'relative'): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	if (fmt === 'datetime') return d.toLocaleString();
	return d.toLocaleDateString();
}

function renderChart(block: ChartBlock): string {
	if (block.chartKind === 'pie') {
		const slices: PieSlice[] =
			block.series[0]?.points.map((p) => ({
				label: String(p.x),
				value: p.y,
				pct: typeof p.label === 'string' ? parsePct(p.label) : 0
			})) ?? [];
		const svg = renderPieSvg(slices, {
			width: 320,
			height: block.height ?? 320,
			legendPosition: 'right'
		});
		const title = block.title
			? `<div style="font-size:13px;color:#6b7280;text-align:center;margin-bottom:6px;">${escapeHtml(block.title)}</div>`
			: '';
		return `<div style="margin:0 0 16px;text-align:center;">${title}${svg}</div>`;
	}
	if (block.chartKind === 'line') {
		const series: LineSeries[] = block.series.map((s) => ({
			name: s.name,
			points: s.points.map((p) => ({ x: String(p.x), y: p.y })),
			color: s.color
		}));
		const svg = renderLineSvg(series, {
			width: 720,
			height: block.height ?? 240,
			yAxisLabel: block.yAxis?.label,
			xAxisLabel: block.xAxis?.label
		});
		const title = block.title
			? `<div style="font-size:13px;color:#6b7280;text-align:center;margin-bottom:6px;">${escapeHtml(block.title)}</div>`
			: '';
		return `<div style="padding:0 24px 24px;"><div style="margin:0 auto;max-width:720px;text-align:center;">${title}${svg}</div></div>`;
	}
	return `<div style="padding:16px;background:#fef3c7;color:#92400e;font-size:13px;border-radius:6px;">Chart kind '${block.chartKind}' not supported in email renderer.</div>`;
}

function parsePct(label: string): number {
	const m = label.match(/(\d+(?:\.\d+)?)/);
	return m ? Number(m[1]) : 0;
}

function renderList(block: ListBlock): string {
	const tag = block.variant === 'numbered' ? 'ol' : block.variant === 'plain' ? 'div' : 'ul';
	const items = block.items
		.map((it) => {
			const primary = it.href
				? `<a href="${it.href}" style="color:#4f46e5;text-decoration:underline;font-weight:600;font-size:14px;">${escapeHtml(it.primary)}</a>`
				: `<span style="font-weight:600;color:#111827;">${escapeHtml(it.primary)}</span>`;
			const secondary = it.secondary
				? `<div style="color:#6b7280;font-size:13px;margin-top:2px;">${escapeHtml(it.secondary)}</div>`
				: '';
			const ts = it.timestamp
				? `<div style="color:#9ca3af;font-size:11px;margin-top:2px;">${escapeHtml(it.timestamp)}</div>`
				: '';
			const badgeHtml = it.badge
				? ` <span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:${TONE_COLORS[it.badge.tone ?? 'neutral'].bg};color:${TONE_COLORS[it.badge.tone ?? 'neutral'].fg};font-size:11px;font-weight:500;">${escapeHtml(it.badge.label)}</span>`
				: '';
			if (tag === 'div') {
				return `<div style="margin-bottom:8px;line-height:1.5;">${primary}${badgeHtml}${secondary}${ts}</div>`;
			}
			return `<li style="margin-bottom:10px;line-height:1.5;">${primary}${badgeHtml}${secondary}${ts}</li>`;
		})
		.join('');
	if (tag === 'div') {
		return `<div style="margin:0 0 12px;">${items}</div>`;
	}
	const listStyle = tag === 'ol' ? 'list-style:decimal;' : 'list-style:disc;';
	return `<${tag} style="margin:0 0 12px;padding:0 0 0 20px;${listStyle}">${items}</${tag}>`;
}

function renderTabs(block: TabsBlock): string {
	const panes = block.panes
		.map(
			(pane) =>
				`<div style="margin:0 0 16px;"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6366f1;margin:0 0 8px;">${escapeHtml(pane.label)}</div>${pane.blocks.map(renderBlock).join('\n')}</div>`
		)
		.join('');
	return panes;
}

function renderGraph(_block: GraphBlock): string {
	return '<div style="padding:16px;background:#f3f4f6;color:#6b7280;font-size:13px;border-radius:6px;text-align:center;">Interactive graph not available in this view.</div>';
}

function renderLink(block: LinkBlock): string {
	const targetAttr = block.external ? ' target="_blank" rel="noopener noreferrer"' : '';
	return `<a href="${block.href}"${targetAttr} style="color:#4f46e5;text-decoration:underline;">${escapeHtml(block.label)}</a>`;
}

function renderBadge(block: BadgeBlock): string {
	const tone = TONE_COLORS[block.tone ?? 'neutral'];
	return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:${tone.bg};color:${tone.fg};font-size:11px;font-weight:500;">${escapeHtml(block.label)}</span>`;
}

function renderDivider(_block: DividerBlock): string {
	return '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">';
}

function renderEmptyState(block: EmptyStateBlock): string {
	const body = block.body
		? `<div style="font-size:14px;color:#6b7280;margin-top:6px;">${escapeHtml(block.body)}</div>`
		: '';
	const cta = block.cta ? `<div style="margin-top:12px;">${renderLink(block.cta)}</div>` : '';
	return `<div style="padding:32px 24px;text-align:center;color:#9ca3af;"><div style="font-weight:600;font-size:15px;color:#374151;">${escapeHtml(block.title)}</div>${body}${cta}</div>`;
}

function renderRawHtml(block: RawHtmlBlock): string {
	return block.html;
}
