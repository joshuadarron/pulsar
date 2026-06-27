'use client';

import type {
	BadgeBlock,
	Block,
	CardBlock,
	ChartBlock,
	DividerBlock,
	EmptyStateBlock,
	GraphBlock,
	GraphNode,
	HeadingBlock,
	KpiGridBlock,
	LinkBlock,
	ListBlock,
	MarkdownBlock,
	RawHtmlBlock,
	SectionBlock,
	TabPane,
	TableBlock,
	TableCell,
	TabsBlock,
	TextBlock,
	Tone,
	ViewModel
} from '@pulsar/view-model';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type LineSeries, renderLineSvg } from '../../lib/charts/line-svg';
import { type PieSlice, renderPieSvg } from '../../lib/charts/pie-svg';
import { renderMarkdownEmail } from '../../lib/viewModel/markdown';

// biome-ignore lint/suspicious/noExplicitAny: react-force-graph-2d ships without first-class TS types
const ForceGraph2D = dynamic(() => import('react-force-graph-2d') as any, { ssr: false }) as any;

const GRAPH_GROUP_COLORS = [
	'#7c3aed',
	'#ec4899',
	'#10b981',
	'#f59e0b',
	'#41b6e6',
	'#a855f7',
	'#ef4444',
	'#14b8a6',
	'#f97316',
	'#84cc16',
	'#8b5cf6',
	'#d946ef'
];
const ENTITY_GROUP_COLOR = '#facc15';
const FALLBACK_GROUP_COLOR = '#9ca3af';

function colorForGroup(group: string | undefined): string {
	if (!group) return FALLBACK_GROUP_COLOR;
	if (group === 'entity') return ENTITY_GROUP_COLOR;
	let hash = 0;
	for (let i = 0; i < group.length; i++) hash = (hash * 31 + group.charCodeAt(i)) | 0;
	const idx =
		((hash % GRAPH_GROUP_COLORS.length) + GRAPH_GROUP_COLORS.length) % GRAPH_GROUP_COLORS.length;
	return GRAPH_GROUP_COLORS[idx];
}

const TONE_CLASSES: Record<Tone, string> = {
	neutral: 'bg-surface text-text-sec border border-border',
	positive: 'bg-success/15 text-success border border-success/30',
	negative: 'bg-danger/15 text-danger border border-danger/30',
	warn: 'bg-warning/15 text-warning border border-warning/30',
	info: 'bg-accent-soft text-accent border border-accent/30'
};

export default function Renderer({ vm }: { vm: ViewModel }) {
	return (
		<div className="space-y-6">
			{vm.blocks.map((block, i) => (
				<BlockView key={i} block={block} />
			))}
		</div>
	);
}

function BlockView({ block }: { block: Block }) {
	switch (block.kind) {
		case 'section':
			return <Section block={block} />;
		case 'heading':
			return <Heading block={block} />;
		case 'text':
			return <Text block={block} />;
		case 'markdown':
			return <Markdown block={block} />;
		case 'card':
			return <Card block={block} />;
		case 'kpiGrid':
			return <KpiGrid block={block} />;
		case 'table':
			return <Table block={block} />;
		case 'chart':
			return <Chart block={block} />;
		case 'list':
			return <List block={block} />;
		case 'tabs':
			return <Tabs block={block} />;
		case 'graph':
			return <Graph block={block} />;
		case 'link':
			return <Link block={block} />;
		case 'badge':
			return <Badge block={block} />;
		case 'divider':
			return <Divider />;
		case 'emptyState':
			return <EmptyState block={block} />;
		case 'rawHtml':
			return <RawHtml block={block} />;
	}
}

function Section({ block }: { block: SectionBlock }) {
	return (
		<section id={block.id} className="rounded-lg border border-border bg-surface p-6 space-y-3">
			{block.title && <h2 className="text-xl font-semibold text-text-pri">{block.title}</h2>}
			{block.subtitle && <p className="text-sm text-text-muted">{block.subtitle}</p>}
			{block.blocks.map((b, i) => (
				<BlockView key={i} block={b} />
			))}
		</section>
	);
}

function Heading({ block }: { block: HeadingBlock }) {
	const sizes: Record<HeadingBlock['level'], string> = {
		1: 'text-2xl',
		2: 'text-xl',
		3: 'text-lg',
		4: 'text-base'
	};
	const Tag = `h${block.level}` as unknown as 'h1' | 'h2' | 'h3' | 'h4';
	return (
		<Tag id={block.id} className={`${sizes[block.level]} font-semibold text-text-pri`}>
			{block.text}
		</Tag>
	);
}

function Text({ block }: { block: TextBlock }) {
	const tone = {
		normal: 'text-text-pri',
		muted: 'text-text-muted',
		strong: 'font-semibold text-text-pri'
	}[block.emphasis ?? 'normal'];
	return <p className={`text-sm leading-relaxed ${tone}`}>{block.body}</p>;
}

function Markdown({ block }: { block: MarkdownBlock }) {
	const html = renderMarkdownEmail(block.body);
	return (
		<div
			className="space-y-3 text-sm leading-relaxed text-text-pri [&_strong]:text-text-pri [&_a]:text-accent [&_a]:underline [&_ol]:list-decimal [&_ul]:list-disc [&_ol]:pl-5 [&_ul]:pl-5 [&_li]:my-1"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shared markdown helper sanitizes input via escapeHtml
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

function Card({ block }: { block: CardBlock }) {
	const inner = (
		<div className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-hover">
			<div className="text-xs font-mono uppercase tracking-[0.08em] text-text-muted">
				{block.title}
			</div>
			{block.value !== undefined && (
				<div className="mt-1 text-2xl font-bold text-text-pri">{block.value}</div>
			)}
			{block.trend && (
				<div
					className={`text-xs ${TONE_CLASSES[block.trend.tone ?? 'neutral']} px-2 py-0.5 rounded-sm inline-block mt-1`}
				>
					{block.trend.deltaLabel}
				</div>
			)}
			{block.footer && <div className="mt-2 text-xs text-text-muted">{block.footer}</div>}
		</div>
	);
	if (block.href) {
		return (
			<a href={block.href} className="block no-underline">
				{inner}
			</a>
		);
	}
	return inner;
}

function KpiGrid({ block }: { block: KpiGridBlock }) {
	const cols = block.columns ?? 4;
	const colsClass = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }[cols];
	return (
		<div className={`grid grid-cols-1 gap-3 ${colsClass}`}>
			{block.cards.map((c, i) => (
				<Card key={i} block={c} />
			))}
		</div>
	);
}

function Table({ block }: { block: TableBlock }) {
	if (block.rows.length === 0) {
		return <p className="text-sm italic text-text-muted">{block.emptyText ?? 'No data.'}</p>;
	}
	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			<table className="min-w-full text-sm">
				<thead className="bg-bg-alt">
					<tr>
						{block.columns.map((c) => (
							<th
								key={c.key}
								className={`px-3 py-2 text-${c.align ?? 'left'} font-mono text-xs font-semibold uppercase tracking-[0.08em] text-text-muted`}
								style={c.width ? { width: c.width } : undefined}
							>
								{c.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{block.rows.map((row) => (
						<tr
							key={row.id}
							className="border-t border-border hover:bg-surface-hover transition-colors"
						>
							{block.columns.map((c) => (
								<td key={c.key} className={`px-3 py-2 text-${c.align ?? 'left'} text-text-pri`}>
									<TableCellView cell={row.cells[c.key]} />
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function TableCellView({ cell }: { cell: TableCell | undefined }) {
	if (!cell) return null;
	switch (cell.kind) {
		case 'text':
			return <>{cell.value}</>;
		case 'number':
			if (cell.format === 'percent') return <>{Math.round(cell.value * 100)}%</>;
			if (cell.format === 'integer') return <>{Math.round(cell.value).toLocaleString()}</>;
			if (cell.format === 'decimal') return <>{cell.value.toFixed(2)}</>;
			return <>{cell.value}</>;
		case 'link':
			return (
				<a
					href={cell.href}
					target={cell.external ? '_blank' : undefined}
					rel={cell.external ? 'noopener noreferrer' : undefined}
					className="text-accent underline"
				>
					{cell.label}
				</a>
			);
		case 'badge':
			return (
				<span
					className={`inline-block rounded-sm px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[cell.tone ?? 'neutral']}`}
				>
					{cell.label}
				</span>
			);
		case 'date': {
			const d = new Date(cell.iso);
			if (Number.isNaN(d.getTime())) return <>{cell.iso}</>;
			if (cell.format === 'datetime') return <>{d.toLocaleString()}</>;
			return <>{d.toLocaleDateString()}</>;
		}
	}
}

function Chart({ block }: { block: ChartBlock }) {
	if (block.chartKind === 'pie') {
		const slices: PieSlice[] =
			block.series[0]?.points.map((p) => ({
				label: String(p.x),
				value: p.y,
				pct: typeof p.label === 'string' ? Number(p.label.replace(/[^0-9.]/g, '')) || 0 : 0
			})) ?? [];
		const svg = renderPieSvg(slices, {
			width: 320,
			height: block.height ?? 320,
			legendPosition: 'right'
		});
		return (
			<div className="flex flex-col items-center">
				{block.title && (
					<div className="mb-2 font-mono text-xs uppercase tracking-[0.08em] text-text-muted">
						{block.title}
					</div>
				)}
				<div
					// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SVG renderer
					dangerouslySetInnerHTML={{ __html: svg }}
				/>
			</div>
		);
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
		return (
			<div className="mx-auto max-w-[720px] flex flex-col items-center">
				{block.title && (
					<div className="mb-2 font-mono text-xs uppercase tracking-[0.08em] text-text-muted">
						{block.title}
					</div>
				)}
				<div
					// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SVG renderer
					dangerouslySetInnerHTML={{ __html: svg }}
				/>
			</div>
		);
	}
	return (
		<div className="rounded-md bg-warning/10 p-3 text-sm text-warning border border-warning/30">
			Chart kind '{block.chartKind}' not supported.
		</div>
	);
}

function List({ block }: { block: ListBlock }) {
	const variant = block.variant ?? 'bulleted';
	const Tag = variant === 'numbered' ? 'ol' : variant === 'plain' ? 'div' : 'ul';
	const listClass =
		variant === 'numbered'
			? 'list-decimal pl-5 space-y-3'
			: variant === 'bulleted'
				? 'list-disc pl-5 space-y-2'
				: 'space-y-2';
	return (
		<Tag className={listClass}>
			{block.items.map((it, i) => {
				const primary = it.href ? (
					<a
						href={it.href}
						target="_blank"
						rel="noopener noreferrer"
						className="font-semibold text-accent hover:underline"
					>
						{it.primary}
					</a>
				) : (
					<span className="font-semibold text-text-pri">{it.primary}</span>
				);
				const inner = (
					<>
						{primary}
						{it.badge && (
							<span
								className={`ml-2 inline-block rounded-sm px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[it.badge.tone ?? 'neutral']}`}
							>
								{it.badge.label}
							</span>
						)}
						{it.secondary && <div className="mt-0.5 text-sm text-text-sec">{it.secondary}</div>}
						{it.timestamp && (
							<div className="mt-0.5 font-mono text-xs text-text-dim">{it.timestamp}</div>
						)}
					</>
				);
				if (Tag === 'div') {
					return (
						<div key={i} className="leading-snug">
							{inner}
						</div>
					);
				}
				return (
					<li key={i} className="leading-snug">
						{inner}
					</li>
				);
			})}
		</Tag>
	);
}

function Tabs({ block }: { block: TabsBlock }) {
	const initial = block.defaultPane ?? block.panes[0]?.id ?? '';
	const [active, setActive] = useState(initial);
	const activePane: TabPane | undefined = block.panes.find((p) => p.id === active);
	return (
		<div>
			<div className="flex flex-wrap gap-1 border-b border-border">
				{block.panes.map((pane) => (
					<button
						key={pane.id}
						type="button"
						onClick={() => setActive(pane.id)}
						className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
							pane.id === active
								? 'border-accent text-accent'
								: 'border-transparent text-text-muted hover:text-text-pri'
						}`}
					>
						{pane.label}
					</button>
				))}
			</div>
			{activePane && (
				<div className="pt-4 space-y-3">
					{activePane.blocks.map((b, i) => (
						<BlockView key={i} block={b} />
					))}
				</div>
			)}
		</div>
	);
}

function Graph({ block }: { block: GraphBlock }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(600);
	const [selected, setSelected] = useState<GraphNode | null>(null);

	useEffect(() => {
		if (!containerRef.current) return;
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) setWidth(entry.contentRect.width);
		});
		observer.observe(containerRef.current);
		setWidth(containerRef.current.clientWidth);
		return () => observer.disconnect();
	}, []);

	const height = block.height ?? 600;

	const nodeCanvasObject = useCallback(
		(node: GraphNode & { x?: number; y?: number }, ctx: CanvasRenderingContext2D) => {
			const radius = 3 + Math.min(12, Math.sqrt(Math.max(1, node.size ?? 1)));
			ctx.beginPath();
			ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI);
			ctx.fillStyle = colorForGroup(node.group);
			ctx.fill();
			if (radius > 6) {
				ctx.font = '3px sans-serif';
				ctx.textAlign = 'center';
				ctx.fillStyle =
					typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
						? '#d4d4d4'
						: '#1f2937';
				ctx.fillText(node.label.slice(0, 30), node.x ?? 0, (node.y ?? 0) + radius + 4);
			}
		},
		[]
	);

	if (block.nodes.length === 0) {
		return (
			<div className="rounded-md bg-bg-alt p-6 text-sm text-text-sec border border-border">
				Graph has no nodes yet.
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
			<div
				ref={containerRef}
				className="lg:col-span-2 overflow-hidden rounded-lg border border-border bg-surface"
				style={{ height }}
			>
				<ForceGraph2D
					graphData={{ nodes: block.nodes, links: block.links }}
					nodeId="id"
					nodeCanvasObject={nodeCanvasObject}
					onNodeClick={(n: GraphNode) => setSelected(n)}
					linkWidth={(link: { weight?: number }) => Math.sqrt(link.weight ?? 1)}
					linkColor={() =>
						typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
							? 'rgba(255,255,255,0.12)'
							: 'rgba(0,0,0,0.12)'
					}
					width={width}
					height={height}
				/>
			</div>
			<div className="rounded-lg border border-border bg-surface p-5 text-sm">
				<h3 className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">
					Node details
				</h3>
				{selected ? (
					<div className="mt-3 space-y-1.5">
						<p className="text-base font-medium text-text-pri">{selected.label}</p>
						{selected.group && <p className="text-text-sec">Group: {selected.group}</p>}
						{selected.size !== undefined && <p className="text-text-sec">Score: {selected.size}</p>}
					</div>
				) : (
					<p className="mt-3 text-text-dim">Click a node to see details.</p>
				)}
				<div className="mt-6 text-xs text-text-muted space-y-1">
					<p>{block.nodes.length} nodes</p>
					<p>{block.links.length} edges</p>
				</div>
			</div>
		</div>
	);
}

function Link({ block }: { block: LinkBlock }) {
	return (
		<a
			href={block.href}
			target={block.external ? '_blank' : undefined}
			rel={block.external ? 'noopener noreferrer' : undefined}
			className="text-accent underline"
		>
			{block.label}
		</a>
	);
}

function Badge({ block }: { block: BadgeBlock }) {
	return (
		<span
			className={`inline-block rounded-sm px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[block.tone ?? 'neutral']}`}
		>
			{block.label}
		</span>
	);
}

function Divider() {
	return <hr className="my-6 border-border" />;
}

function EmptyState({ block }: { block: EmptyStateBlock }) {
	return (
		<div className="rounded-lg border border-dashed border-border p-8 text-center">
			<div className="font-semibold text-text-pri">{block.title}</div>
			{block.body && <div className="mt-2 text-sm text-text-muted">{block.body}</div>}
			{block.cta && (
				<div className="mt-4">
					<Link block={block.cta} />
				</div>
			)}
		</div>
	);
}

function RawHtml({ block }: { block: RawHtmlBlock }) {
	return (
		<div
			// biome-ignore lint/security/noDangerouslySetInnerHtml: caller-trusted raw HTML escape hatch
			dangerouslySetInnerHTML={{ __html: block.html }}
		/>
	);
}
