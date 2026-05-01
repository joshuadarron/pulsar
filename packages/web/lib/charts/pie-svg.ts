// ---------------------------------------------------------------------------
// Pure-function pie chart SVG renderer.
//
// Used by the report template (server-side) for both the UI and the
// email/PDF variants. Output is a self-contained SVG string with inline
// styles and no external assets, safe to embed via dangerouslySetInnerHTML
// in React or to drop straight into a renderToStaticMarkup HTML tree.
// ---------------------------------------------------------------------------

export type PieSlice = {
	label: string;
	value: number;
	pct: number;
};

export type PieOptions = {
	width?: number;
	height?: number;
	colors?: string[];
	showLegend?: boolean;
	legendPosition?: 'right' | 'below';
};

const DEFAULT_COLORS = [
	'#4f46e5',
	'#7c3aed',
	'#0891b2',
	'#059669',
	'#d97706',
	'#dc2626',
	'#db2777',
	'#2563eb',
	'#65a30d',
	'#9333ea'
];
const OTHER_COLOR = '#9ca3af';

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function colorFor(label: string, index: number, palette: string[]): string {
	if (label.toLowerCase() === 'other') return OTHER_COLOR;
	return palette[index % palette.length];
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
	if (endAngle - startAngle >= Math.PI * 2 - 1e-9) {
		// Full circle, draw as two arcs to keep a valid path.
		const midAngle = startAngle + Math.PI;
		const x1 = cx + r * Math.cos(startAngle);
		const y1 = cy + r * Math.sin(startAngle);
		const xMid = cx + r * Math.cos(midAngle);
		const yMid = cy + r * Math.sin(midAngle);
		return [
			`M ${cx} ${cy}`,
			`L ${x1.toFixed(3)} ${y1.toFixed(3)}`,
			`A ${r} ${r} 0 1 1 ${xMid.toFixed(3)} ${yMid.toFixed(3)}`,
			`A ${r} ${r} 0 1 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`,
			'Z'
		].join(' ');
	}

	const x1 = cx + r * Math.cos(startAngle);
	const y1 = cy + r * Math.sin(startAngle);
	const x2 = cx + r * Math.cos(endAngle);
	const y2 = cy + r * Math.sin(endAngle);
	const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

	return [
		`M ${cx} ${cy}`,
		`L ${x1.toFixed(3)} ${y1.toFixed(3)}`,
		`A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`,
		'Z'
	].join(' ');
}

function renderEmptyState(width: number, height: number): string {
	const safeWidth = Math.max(width, 80);
	const safeHeight = Math.max(height, 80);
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" role="img" aria-label="No data">`,
		`<rect x="0" y="0" width="${safeWidth}" height="${safeHeight}" fill="#f9fafb" />`,
		`<text x="${safeWidth / 2}" y="${safeHeight / 2}" text-anchor="middle" dominant-baseline="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" fill="#9ca3af">No data</text>`,
		'</svg>'
	].join('');
}

/**
 * Render a pie chart as an SVG string.
 *
 * Pure function. No DOM, no React. Output is inline-safe for both UI
 * (dangerouslySetInnerHTML) and email (renderToStaticMarkup HTML).
 */
export function renderPieSvg(slices: PieSlice[], options: PieOptions = {}): string {
	const width = options.width ?? 320;
	const height = options.height ?? 320;
	const palette = options.colors ?? DEFAULT_COLORS;
	const showLegend = options.showLegend ?? true;
	const legendPosition = options.legendPosition ?? 'right';

	const filtered = slices.filter((s) => s.value > 0);
	if (filtered.length === 0) return renderEmptyState(width, height);

	const total = filtered.reduce((acc, s) => acc + s.value, 0);
	if (total <= 0) return renderEmptyState(width, height);

	// Layout: chart on one side, optional legend on the other side or below.
	const legendWidth = showLegend && legendPosition === 'right' ? 140 : 0;
	const legendHeight =
		showLegend && legendPosition === 'below' ? Math.max(60, filtered.length * 18 + 8) : 0;

	const chartWidth = width - legendWidth;
	const chartHeight = height - legendHeight;
	const chartSize = Math.max(40, Math.min(chartWidth, chartHeight));
	const cx = chartSize / 2;
	const cy = chartSize / 2;
	const r = chartSize / 2 - 4;

	let startAngle = -Math.PI / 2;
	const slicePaths: string[] = [];
	const legendItems: string[] = [];

	filtered.forEach((slice, i) => {
		const fraction = slice.value / total;
		const endAngle = startAngle + fraction * Math.PI * 2;
		const fill = colorFor(slice.label, i, palette);
		const path = arcPath(cx, cy, r, startAngle, endAngle);
		slicePaths.push(`<path d="${path}" fill="${fill}" stroke="#ffffff" stroke-width="1" />`);
		const pctLabel = `${slice.pct.toFixed(slice.pct >= 10 ? 0 : 1)}%`;
		legendItems.push(
			`<g transform="translate(0, ${i * 18})"><rect x="0" y="0" width="10" height="10" fill="${fill}" rx="2" ry="2" /><text x="16" y="9" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" fill="#374151">${escapeXml(slice.label)} (${pctLabel})</text></g>`
		);
		startAngle = endAngle;
	});

	const chartGroup = `<g transform="translate(0, ${(height - chartSize) / 2})">${slicePaths.join('')}</g>`;

	let legendGroup = '';
	if (showLegend) {
		if (legendPosition === 'right') {
			const legendX = chartSize + 12;
			const legendY = Math.max(8, (height - filtered.length * 18) / 2);
			legendGroup = `<g transform="translate(${legendX}, ${legendY})">${legendItems.join('')}</g>`;
		} else {
			const legendY = chartSize + 12;
			legendGroup = `<g transform="translate(8, ${legendY})">${legendItems.join('')}</g>`;
		}
	}

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Keyword distribution pie chart">`,
		chartGroup,
		legendGroup,
		'</svg>'
	].join('');
}
