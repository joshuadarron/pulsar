import { query } from '@pulsar/shared/db/postgres';
import {
	type TableColumn,
	type TableRow,
	type Tone,
	type ViewModel,
	emptyState,
	section,
	table,
	view
} from '@pulsar/view-model';

export const FEED_VIEW_ID = 'market-analysis.feed';

export type FeedFilters = {
	source?: string;
	sentiment?: string;
	contentType?: string;
	q?: string;
	page?: number;
	perPage?: number;
};

interface ArticleRow {
	id: string;
	url: string;
	title: string;
	summary: string | null;
	content_type: string | null;
	sentiment: string | null;
	source_name: string;
	source_platform: string;
	score: number | null;
	published_at: Date | null;
}

const SENTIMENT_TONE: Record<string, Tone> = {
	positive: 'positive',
	negative: 'negative',
	neutral: 'neutral'
};

async function loadArticles(filters: FeedFilters): Promise<{ rows: ArticleRow[]; total: number }> {
	const page = Math.max(1, filters.page ?? 1);
	const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20));
	const offset = (page - 1) * perPage;

	const conditions: string[] = [];
	const values: unknown[] = [];

	if (filters.source && filters.source !== 'all') {
		conditions.push(`source_platform = $${conditions.length + 1}`);
		values.push(filters.source);
	}
	if (filters.sentiment && filters.sentiment !== 'all') {
		conditions.push(`sentiment = $${conditions.length + 1}`);
		values.push(filters.sentiment);
	}
	if (filters.contentType && filters.contentType !== 'all') {
		conditions.push(`content_type = $${conditions.length + 1}`);
		values.push(filters.contentType);
	}
	if (filters.q) {
		conditions.push(
			`(title ILIKE $${conditions.length + 1} OR summary ILIKE $${conditions.length + 1})`
		);
		values.push(`%${filters.q}%`);
	}

	const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

	const [articlesRes, countRes] = await Promise.all([
		query<ArticleRow>(
			`SELECT id, url, title, summary, content_type, sentiment, source_name, source_platform, score, published_at
			 FROM articles${where}
			 ORDER BY published_at DESC NULLS LAST
			 LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
			[...values, perPage, offset]
		),
		query<{ count: string }>(`SELECT count(*) FROM articles${where}`, values)
	]);

	return {
		rows: articlesRes.rows,
		total: Number.parseInt(countRes.rows[0]?.count ?? '0', 10)
	};
}

function rowToTableRow(row: ArticleRow): TableRow {
	const sentimentTone = row.sentiment ? (SENTIMENT_TONE[row.sentiment] ?? 'neutral') : 'neutral';
	return {
		id: row.id,
		href: row.url,
		cells: {
			title: { kind: 'link', href: row.url, label: row.title, external: true },
			source: { kind: 'badge', label: row.source_name, tone: 'neutral' },
			sentiment: row.sentiment
				? { kind: 'badge', label: row.sentiment, tone: sentimentTone }
				: { kind: 'text', value: '-' },
			score: { kind: 'number', value: row.score ?? 0, format: 'integer' },
			published: row.published_at
				? { kind: 'date', iso: new Date(row.published_at).toISOString() }
				: { kind: 'text', value: '-' }
		}
	};
}

export function buildFeedViewFromRows(
	rows: ArticleRow[],
	total: number,
	filters: FeedFilters
): ViewModel {
	const page = Math.max(1, filters.page ?? 1);
	const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20));

	if (rows.length === 0) {
		return view(
			FEED_VIEW_ID,
			[emptyState('No articles found.', 'Run a scrape or relax your filters.')],
			{ title: 'Article Feed', meta: { total, page, perPage, filters } }
		);
	}

	const columns: TableColumn[] = [
		{ key: 'title', label: 'Title' },
		{ key: 'source', label: 'Source' },
		{ key: 'sentiment', label: 'Sentiment' },
		{ key: 'score', label: 'Score', align: 'right' },
		{ key: 'published', label: 'Published' }
	];

	return view(
		FEED_VIEW_ID,
		[
			section(
				undefined,
				[
					table(columns, rows.map(rowToTableRow), {
						pagination: { page, perPage, total }
					})
				],
				{ subtitle: `${total.toLocaleString()} articles collected` }
			)
		],
		{ title: 'Article Feed', meta: { total, page, perPage, filters } }
	);
}

export async function buildFeedView(filters: FeedFilters = {}): Promise<ViewModel> {
	const { rows, total } = await loadArticles(filters);
	return buildFeedViewFromRows(rows, total, filters);
}
