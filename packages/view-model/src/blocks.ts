// Block primitive types for shell-renderable view-models.
// Every block is JSON-serializable; no functions, no React.
// The shell decides how to render each block.kind.

export type Tone = 'neutral' | 'positive' | 'negative' | 'warn' | 'info';

export type Block =
	| SectionBlock
	| HeadingBlock
	| TextBlock
	| MarkdownBlock
	| CardBlock
	| KpiGridBlock
	| TableBlock
	| ChartBlock
	| ListBlock
	| TabsBlock
	| GraphBlock
	| LinkBlock
	| BadgeBlock
	| DividerBlock
	| EmptyStateBlock
	| RawHtmlBlock;

export type SectionBlock = {
	kind: 'section';
	id?: string;
	title?: string;
	subtitle?: string;
	blocks: Block[];
};

export type HeadingBlock = {
	kind: 'heading';
	level: 1 | 2 | 3 | 4;
	text: string;
	id?: string;
};

export type TextBlock = {
	kind: 'text';
	body: string;
	emphasis?: 'normal' | 'muted' | 'strong';
};

export type MarkdownBlock = {
	kind: 'markdown';
	body: string;
};

export type CardBlock = {
	kind: 'card';
	title: string;
	value?: string | number;
	trend?: CardTrend;
	footer?: string;
	href?: string;
	tone?: Tone;
};

export type CardTrend = {
	direction: 'up' | 'down' | 'flat';
	deltaLabel: string;
	tone?: Tone;
};

export type KpiGridBlock = {
	kind: 'kpiGrid';
	columns?: 2 | 3 | 4;
	cards: CardBlock[];
};

export type TableBlock = {
	kind: 'table';
	columns: TableColumn[];
	rows: TableRow[];
	pagination?: TablePagination;
	sort?: TableSort;
	emptyText?: string;
};

export type TableColumn = {
	key: string;
	label: string;
	align?: 'left' | 'center' | 'right';
	width?: string;
	sortable?: boolean;
};

export type TableRow = {
	id: string;
	cells: Record<string, TableCell>;
	href?: string;
};

export type TableCell =
	| { kind: 'text'; value: string }
	| { kind: 'number'; value: number; format?: 'integer' | 'percent' | 'decimal' }
	| { kind: 'link'; href: string; label: string; external?: boolean }
	| { kind: 'badge'; label: string; tone?: Tone }
	| { kind: 'date'; iso: string; format?: 'date' | 'datetime' | 'relative' };

export type TablePagination = {
	page: number;
	perPage: number;
	total: number;
};

export type TableSort = {
	column: string;
	direction: 'asc' | 'desc';
};

export type ChartBlock = {
	kind: 'chart';
	chartKind: 'line' | 'pie' | 'bar' | 'area';
	title?: string;
	series: ChartSeries[];
	xAxis?: ChartAxis;
	yAxis?: ChartAxis;
	height?: number;
};

export type ChartSeries = {
	name: string;
	points: ChartPoint[];
	color?: string;
};

export type ChartPoint = {
	x: string | number;
	y: number;
	label?: string;
};

export type ChartAxis = {
	label?: string;
	type?: 'category' | 'time' | 'numeric';
};

export type ListBlock = {
	kind: 'list';
	items: ListItem[];
	variant?: 'bulleted' | 'numbered' | 'plain';
};

export type ListItem = {
	primary: string;
	secondary?: string;
	timestamp?: string;
	href?: string;
	badge?: { label: string; tone?: Tone };
};

export type TabsBlock = {
	kind: 'tabs';
	panes: TabPane[];
	defaultPane?: string;
};

export type TabPane = {
	id: string;
	label: string;
	blocks: Block[];
};

export type GraphBlock = {
	kind: 'graph';
	nodes: GraphNode[];
	links: GraphLink[];
	height?: number;
};

export type GraphNode = {
	id: string;
	label: string;
	group?: string;
	size?: number;
};

export type GraphLink = {
	source: string;
	target: string;
	weight?: number;
};

export type LinkBlock = {
	kind: 'link';
	href: string;
	label: string;
	external?: boolean;
};

export type BadgeBlock = {
	kind: 'badge';
	label: string;
	tone?: Tone;
};

export type DividerBlock = {
	kind: 'divider';
};

export type EmptyStateBlock = {
	kind: 'emptyState';
	title: string;
	body?: string;
	cta?: LinkBlock;
};

// Escape hatch for content that cannot be expressed as a block.
// Shells may refuse to render this in untrusted contexts.
export type RawHtmlBlock = {
	kind: 'rawHtml';
	html: string;
};

export type ViewModel = {
	schemaVersion: '1';
	view: string;
	title?: string;
	meta?: Record<string, unknown>;
	blocks: Block[];
};
