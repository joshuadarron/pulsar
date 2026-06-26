// Small builder helpers for common block shapes.
// View modules import these to keep call sites terse.

import type {
	BadgeBlock,
	Block,
	CardBlock,
	CardTrend,
	ChartBlock,
	ChartSeries,
	DividerBlock,
	EmptyStateBlock,
	GraphBlock,
	GraphLink,
	GraphNode,
	HeadingBlock,
	KpiGridBlock,
	LinkBlock,
	ListBlock,
	ListItem,
	MarkdownBlock,
	RawHtmlBlock,
	SectionBlock,
	TabPane,
	TableBlock,
	TableColumn,
	TableRow,
	TabsBlock,
	TextBlock,
	Tone,
	ViewModel
} from './blocks.js';

export const section = (
	title: string | undefined,
	blocks: Block[],
	opts: { id?: string; subtitle?: string } = {}
): SectionBlock => ({
	kind: 'section',
	title,
	blocks,
	...opts
});

export const heading = (level: HeadingBlock['level'], text: string, id?: string): HeadingBlock => ({
	kind: 'heading',
	level,
	text,
	id
});

export const text = (body: string, emphasis?: TextBlock['emphasis']): TextBlock => ({
	kind: 'text',
	body,
	emphasis
});

export const markdown = (body: string): MarkdownBlock => ({ kind: 'markdown', body });

export const card = (
	title: string,
	value: string | number | undefined,
	opts: { trend?: CardTrend; footer?: string; href?: string; tone?: Tone } = {}
): CardBlock => ({ kind: 'card', title, value, ...opts });

export const kpiGrid = (
	cards: CardBlock[],
	columns: KpiGridBlock['columns'] = 4
): KpiGridBlock => ({
	kind: 'kpiGrid',
	columns,
	cards
});

export const table = (
	columns: TableColumn[],
	rows: TableRow[],
	opts: Omit<TableBlock, 'kind' | 'columns' | 'rows'> = {}
): TableBlock => ({ kind: 'table', columns, rows, ...opts });

export const chart = (
	chartKind: ChartBlock['chartKind'],
	series: ChartSeries[],
	opts: Omit<ChartBlock, 'kind' | 'chartKind' | 'series'> = {}
): ChartBlock => ({ kind: 'chart', chartKind, series, ...opts });

export const list = (items: ListItem[], variant: ListBlock['variant'] = 'bulleted'): ListBlock => ({
	kind: 'list',
	items,
	variant
});

export const tabs = (panes: TabPane[], defaultPane?: string): TabsBlock => ({
	kind: 'tabs',
	panes,
	defaultPane
});

export const graph = (nodes: GraphNode[], links: GraphLink[], height?: number): GraphBlock => ({
	kind: 'graph',
	nodes,
	links,
	height
});

export const link = (href: string, label: string, external = false): LinkBlock => ({
	kind: 'link',
	href,
	label,
	external
});

export const badge = (label: string, tone: Tone = 'neutral'): BadgeBlock => ({
	kind: 'badge',
	label,
	tone
});

export const divider = (): DividerBlock => ({ kind: 'divider' });

export const emptyState = (title: string, body?: string, cta?: LinkBlock): EmptyStateBlock => ({
	kind: 'emptyState',
	title,
	body,
	cta
});

export const rawHtml = (html: string): RawHtmlBlock => ({ kind: 'rawHtml', html });

export const view = (
	viewId: string,
	blocks: Block[],
	opts: { title?: string; meta?: Record<string, unknown> } = {}
): ViewModel => ({
	schemaVersion: '1',
	view: viewId,
	blocks,
	...opts
});
