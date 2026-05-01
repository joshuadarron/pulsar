// ---------------------------------------------------------------------------
// Pure-function line chart SVG renderer.
//
// Renders a multi-series line chart with axes, gridlines, and an inline
// legend. Pure function: no DOM, no React. Output is inline-safe for both
// the UI (dangerouslySetInnerHTML) and the email/PDF variant
// (renderToStaticMarkup).
// ---------------------------------------------------------------------------

export type LinePoint = {
	x: string;
	y: number;
};

export type LineSeries = {
	name: string;
	points: LinePoint[];
	color?: string;
};

export type LineOptions = {
	width?: number;
	height?: number;
	colors?: string[];
	yAxisLabel?: string;
	xAxisLabel?: string;
	emptyMessage?: string;
};

const DEFAULT_COLORS = [
	'#4f46e5',
	'#0891b2',
	'#059669',
	'#d97706',
	'#dc2626',
	'#7c3aed',
	'#db2777',
	'#2563eb'
];

const SPARSE_FOOTNOTE =
	'Limited to current ingestion window. Historical depth fills in as backfill completes.';

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function renderEmptyState(width: number, height: number, message: string): string {
	const safeWidth = Math.max(width, 80);
	const safeHeight = Math.max(height, 80);
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" role="img" aria-label="No data">`,
		`<rect x="0" y="0" width="${safeWidth}" height="${safeHeight}" fill="#f9fafb" />`,
		`<text x="${safeWidth / 2}" y="${safeHeight / 2}" text-anchor="middle" dominant-baseline="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" fill="#6b7280">${escapeXml(message)}</text>`,
		'</svg>'
	].join('');
}

function isSparse(series: LineSeries[]): boolean {
	return series.every((s) => s.points.length <= 1);
}

function uniqueSortedXs(series: LineSeries[]): string[] {
	const set = new Set<string>();
	for (const s of series) {
		for (const p of s.points) set.add(p.x);
	}
	return [...set].sort();
}

/**
 * Render a multi-series line chart as an SVG string.
 *
 * Sparse-data handling: when every series has 1 or fewer points, the chart
 * renders an empty state with a footnote explaining that backfill depth
 * has not yet filled in. Callers can also detect sparseness via the input
 * data and render their own surrounding caption.
 */
export function renderLineSvg(seriesInput: LineSeries[], options: LineOptions = {}): string {
	const width = options.width ?? 720;
	const height = options.height ?? 240;
	const palette = options.colors ?? DEFAULT_COLORS;
	const yAxisLabel = options.yAxisLabel;
	const xAxisLabel = options.xAxisLabel;

	const series = seriesInput.filter((s) => s.points.length > 0);

	if (series.length === 0) {
		return renderEmptyState(width, height, options.emptyMessage ?? 'No historical data yet');
	}

	if (isSparse(series)) {
		return renderEmptyState(width, height, options.emptyMessage ?? SPARSE_FOOTNOTE);
	}

	const padding = { top: 16, right: 16, bottom: 44, left: 48 };
	if (yAxisLabel) padding.left += 18;
	if (xAxisLabel) padding.bottom += 18;

	const plotWidth = Math.max(40, width - padding.left - padding.right - 130);
	const plotHeight = Math.max(40, height - padding.top - padding.bottom);
	const legendX = padding.left + plotWidth + 16;

	const xs = uniqueSortedXs(series);
	const xIndex = new Map(xs.map((x, i) => [x, i]));

	const allYs = series.flatMap((s) => s.points.map((p) => p.y));
	const minY = 0;
	const maxYRaw = Math.max(...allYs, 0);
	const maxY = maxYRaw === 0 ? 1 : maxYRaw;

	const xStep = xs.length > 1 ? plotWidth / (xs.length - 1) : 0;

	function px(x: string): number {
		const idx = xIndex.get(x) ?? 0;
		return padding.left + idx * xStep;
	}

	function py(y: number): number {
		const range = maxY - minY;
		if (range <= 0) return padding.top + plotHeight;
		return padding.top + plotHeight - ((y - minY) / range) * plotHeight;
	}

	// Gridlines (horizontal, 4 evenly spaced).
	const gridlines: string[] = [];
	const yLabels: string[] = [];
	const ticks = 4;
	for (let i = 0; i <= ticks; i++) {
		const yValue = minY + ((maxY - minY) * i) / ticks;
		const yPos = py(yValue);
		gridlines.push(
			`<line x1="${padding.left}" y1="${yPos.toFixed(2)}" x2="${(padding.left + plotWidth).toFixed(2)}" y2="${yPos.toFixed(2)}" stroke="#f3f4f6" stroke-width="1" />`
		);
		yLabels.push(
			`<text x="${padding.left - 6}" y="${(yPos + 4).toFixed(2)}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10" fill="#9ca3af">${formatTick(yValue)}</text>`
		);
	}

	// X-axis labels: show up to 8 evenly spaced.
	const xLabelStep = Math.max(1, Math.ceil(xs.length / 8));
	const xLabels: string[] = [];
	xs.forEach((x, i) => {
		if (i % xLabelStep !== 0 && i !== xs.length - 1) return;
		const xp = px(x);
		xLabels.push(
			`<text x="${xp.toFixed(2)}" y="${(padding.top + plotHeight + 14).toFixed(2)}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10" fill="#9ca3af">${escapeXml(x)}</text>`
		);
	});

	// Series lines and points.
	const seriesLines: string[] = [];
	const legendItems: string[] = [];

	series.forEach((s, i) => {
		const color = s.color ?? palette[i % palette.length];
		const sortedPoints = [...s.points].sort((a, b) => {
			return (xIndex.get(a.x) ?? 0) - (xIndex.get(b.x) ?? 0);
		});
		const path = sortedPoints
			.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${px(p.x).toFixed(2)} ${py(p.y).toFixed(2)}`)
			.join(' ');
		seriesLines.push(
			`<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`
		);
		for (const p of sortedPoints) {
			seriesLines.push(
				`<circle cx="${px(p.x).toFixed(2)}" cy="${py(p.y).toFixed(2)}" r="2.5" fill="${color}" />`
			);
		}
		legendItems.push(
			`<g transform="translate(0, ${i * 18})"><rect x="0" y="0" width="10" height="10" fill="${color}" rx="2" ry="2" /><text x="16" y="9" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" fill="#374151">${escapeXml(s.name)}</text></g>`
		);
	});

	// Axis lines.
	const axes = [
		`<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}" stroke="#d1d5db" stroke-width="1" />`,
		`<line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight}" stroke="#d1d5db" stroke-width="1" />`
	];

	// Optional axis labels.
	const labelGroups: string[] = [];
	if (yAxisLabel) {
		labelGroups.push(
			`<text x="14" y="${(padding.top + plotHeight / 2).toFixed(2)}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" fill="#6b7280" transform="rotate(-90 14 ${(padding.top + plotHeight / 2).toFixed(2)})">${escapeXml(yAxisLabel)}</text>`
		);
	}
	if (xAxisLabel) {
		labelGroups.push(
			`<text x="${(padding.left + plotWidth / 2).toFixed(2)}" y="${(height - 6).toFixed(2)}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" fill="#6b7280">${escapeXml(xAxisLabel)}</text>`
		);
	}

	const legendY = padding.top;
	const legendGroup = `<g transform="translate(${legendX}, ${legendY})">${legendItems.join('')}</g>`;

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Entity centrality over time">`,
		`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />`,
		gridlines.join(''),
		axes.join(''),
		yLabels.join(''),
		xLabels.join(''),
		seriesLines.join(''),
		legendGroup,
		labelGroups.join(''),
		'</svg>'
	].join('');
}

function formatTick(value: number): string {
	if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
	if (Number.isInteger(value)) return value.toString();
	return value.toFixed(2);
}

export { SPARSE_FOOTNOTE };
