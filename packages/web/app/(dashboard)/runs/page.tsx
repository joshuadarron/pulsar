'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Run {
	id: string;
	started_at: string;
	completed_at: string | null;
	status: string;
	trigger: string;
	run_type: string;
	articles_scraped: number;
	articles_new: number;
	error_log: string | null;
}

const ROW_OPTIONS = [10, 15, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

function formatDuration(startedAt: string, completedAt: string | null): string {
	const start = new Date(startedAt).getTime();
	const end = completedAt ? new Date(completedAt).getTime() : Date.now();
	const total = Math.floor((end - start) / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function LiveDuration({
	startedAt,
	completedAt,
	status
}: { startedAt: string; completedAt: string | null; status: string }) {
	const [display, setDisplay] = useState(() => formatDuration(startedAt, completedAt));

	useEffect(() => {
		if (status !== 'running') {
			setDisplay(formatDuration(startedAt, completedAt));
			return;
		}
		const timer = setInterval(() => setDisplay(formatDuration(startedAt, null)), 1000);
		return () => clearInterval(timer);
	}, [startedAt, completedAt, status]);

	return (
		<span className="tabular-nums">
			{display}
			{status === 'running' && (
				<span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
			)}
		</span>
	);
}

type SortKey =
	| 'run_type'
	| 'trigger'
	| 'started_at'
	| 'completed_at'
	| 'status'
	| 'articles_scraped'
	| 'articles_new';
type SortOrder = 'asc' | 'desc';
type SortSpec = { key: SortKey; order: SortOrder };

const SORT_KEYS: ReadonlySet<SortKey> = new Set([
	'run_type',
	'trigger',
	'started_at',
	'completed_at',
	'status',
	'articles_scraped',
	'articles_new'
]);
const DEFAULT_SORTS: SortSpec[] = [{ key: 'started_at', order: 'desc' }];
const SORTS_STORAGE_KEY = 'runs_sorts';

function isValidSpec(s: unknown): s is SortSpec {
	if (!s || typeof s !== 'object') return false;
	const obj = s as { key?: unknown; order?: unknown };
	return (
		typeof obj.key === 'string' &&
		SORT_KEYS.has(obj.key as SortKey) &&
		(obj.order === 'asc' || obj.order === 'desc')
	);
}

function readStoredSorts(): SortSpec[] {
	if (typeof window === 'undefined') return DEFAULT_SORTS;
	try {
		const raw = localStorage.getItem(SORTS_STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				const valid = parsed.filter(isValidSpec);
				if (valid.length > 0) return valid;
			}
		}
	} catch {
		// fall through to legacy migration
	}
	// Migrate from the old single-column storage keys, written as a one-shot.
	const legacyKey = localStorage.getItem('runs_sortBy');
	const legacyOrder = localStorage.getItem('runs_sortOrder');
	if (legacyKey && SORT_KEYS.has(legacyKey as SortKey)) {
		const order: SortOrder = legacyOrder === 'asc' ? 'asc' : 'desc';
		return [{ key: legacyKey as SortKey, order }];
	}
	return DEFAULT_SORTS;
}

export default function RunsPage() {
	const router = useRouter();
	const [runs, setRuns] = useState<Run[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [sorts, setSorts] = useState<SortSpec[]>(readStoredSorts);
	const [pageSize, setPageSize] = useState(() => {
		if (typeof window !== 'undefined') {
			const saved = Number.parseInt(localStorage.getItem('runs_pageSize') || '');
			if (ROW_OPTIONS.includes(saved as (typeof ROW_OPTIONS)[number])) return saved;
		}
		return DEFAULT_PAGE_SIZE;
	});
	const [triggering, setTriggering] = useState<string | null>(null);
	const [message, setMessage] = useState('');
	const [runningTypes, setRunningTypes] = useState<Record<string, string>>({});

	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	const sortParam = sorts.map((s) => `${s.key}:${s.order}`).join(',');

	function handlePageSizeChange(size: number) {
		setPageSize(size);
		localStorage.setItem('runs_pageSize', String(size));
		setPage(1);
	}

	/**
	 * Plain click → single-column sort on this key (flips direction if it was
	 * already the primary sort). Shift-click → toggle this column inside the
	 * existing sort list (cycle desc → asc → removed). At least one column is
	 * always retained so the table stays deterministic.
	 */
	function handleSort(key: SortKey, additive: boolean) {
		setSorts((prev) => {
			let next: SortSpec[];
			if (additive) {
				const idx = prev.findIndex((s) => s.key === key);
				if (idx === -1) {
					next = [...prev, { key, order: 'desc' }];
				} else if (prev[idx].order === 'desc') {
					next = prev.map((s, i) => (i === idx ? { ...s, order: 'asc' } : s));
				} else {
					next = prev.filter((_, i) => i !== idx);
				}
			} else {
				const primary = prev[0];
				if (primary && primary.key === key) {
					next = [{ key, order: primary.order === 'desc' ? 'asc' : 'desc' }];
				} else {
					next = [{ key, order: 'desc' }];
				}
			}
			if (next.length === 0) next = DEFAULT_SORTS;
			localStorage.setItem(SORTS_STORAGE_KEY, JSON.stringify(next));
			return next;
		});
		setPage(1);
	}

	const fetchRuns = useCallback(() => {
		Promise.all([
			fetch(`/api/runs?page=${page}&limit=${pageSize}&sort=${sortParam}`).then((r) => r.json()),
			fetch('/api/runs/trigger').then((r) => r.json())
		]).then(([runsData, statusData]) => {
			setRuns(runsData.runs);
			setTotal(runsData.total);
			setRunningTypes(statusData.running);
		});
	}, [page, pageSize, sortParam]);

	useEffect(() => {
		fetchRuns();
		const interval = setInterval(fetchRuns, 3000);
		return () => clearInterval(interval);
	}, [fetchRuns]);

	async function trigger(type: 'scrape' | 'pipeline') {
		setTriggering(type);
		setMessage('');
		try {
			const res = await fetch('/api/runs/trigger', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type })
			});
			if (res.status === 409) {
				const data = await res.json();
				setMessage(data.error);
				return;
			}
			if (res.ok) {
				setMessage(`${type} triggered successfully.`);
				setPage(1);
				// Poll rapidly until the new run appears
				let attempts = 0;
				const poll = setInterval(async () => {
					const r = await fetch(`/api/runs?page=1&limit=${pageSize}&sort=${sortParam}`);
					const data = await r.json();
					setRuns(data.runs);
					setTotal(data.total);
					attempts++;
					if (attempts >= 10 || data.runs[0]?.status === 'running') clearInterval(poll);
				}, 500);
			} else {
				setMessage(`Failed to trigger ${type}.`);
			}
		} catch {
			setMessage(`Error triggering ${type}.`);
		} finally {
			setTriggering(null);
		}
	}

	return (
		<div>
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Run History</h1>
					<p className="mt-1 text-gray-500 dark:text-neutral-400">
						All scrape and pipeline run logs
					</p>
				</div>
				<div className="flex gap-3">
					<button
						onClick={() => trigger('scrape')}
						disabled={triggering !== null || 'scrape' in runningTypes}
						className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{triggering === 'scrape'
							? 'Triggering...'
							: 'scrape' in runningTypes
								? 'Scrape Running...'
								: 'Run Scrape'}
					</button>
					<button
						onClick={() => trigger('pipeline')}
						disabled={triggering !== null || 'pipeline' in runningTypes}
						className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
					>
						{triggering === 'pipeline'
							? 'Triggering...'
							: 'pipeline' in runningTypes
								? 'Report Running...'
								: 'Run Report'}
					</button>
				</div>
			</div>
			{message && (
				<p
					className={`mt-2 text-sm ${message.includes('already') ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}`}
				>
					{message}
				</p>
			)}

			<div className="mt-6 overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
				<table className="min-w-full divide-y divide-gray-200 dark:divide-neutral-700">
					<thead className="bg-gray-50 dark:bg-neutral-800">
						<tr>
							<SortHeader label="Type" sortKey="run_type" sorts={sorts} onSort={handleSort} />
							<SortHeader label="Trigger" sortKey="trigger" sorts={sorts} onSort={handleSort} />
							<SortHeader label="Started" sortKey="started_at" sorts={sorts} onSort={handleSort} />
							<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
								Duration
							</th>
							<SortHeader label="Status" sortKey="status" sorts={sorts} onSort={handleSort} />
							<SortHeader
								label="Articles"
								sortKey="articles_scraped"
								sorts={sorts}
								onSort={handleSort}
							/>
							<SortHeader label="New" sortKey="articles_new" sorts={sorts} onSort={handleSort} />
						</tr>
					</thead>
					<tbody className="divide-y divide-gray-200 dark:divide-neutral-700">
						{runs.length === 0 ? (
							<tr>
								<td
									colSpan={7}
									className="px-4 py-8 text-center text-gray-400 dark:text-neutral-500"
								>
									No runs yet.
								</td>
							</tr>
						) : (
							runs.map((run) => (
								<tr
									key={run.id}
									onClick={() => router.push(`/runs/${run.id}`)}
									className="cursor-pointer hover:bg-gray-50 dark:hover:bg-neutral-800"
								>
									<td className="px-4 py-4 text-sm">
										<span
											className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
												run.run_type === 'scrape'
													? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
													: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
											}`}
										>
											{run.run_type}
										</span>
									</td>
									<td className="px-4 py-4 text-sm text-gray-600 dark:text-neutral-400 capitalize">
										{run.trigger}
									</td>
									<td className="px-4 py-4 text-sm text-gray-600 dark:text-neutral-400">
										{new Date(run.started_at).toLocaleString()}
									</td>
									<td className="px-4 py-4 text-sm text-gray-600 dark:text-neutral-400">
										<LiveDuration
											startedAt={run.started_at}
											completedAt={run.completed_at}
											status={run.status}
										/>
									</td>
									<td className="px-4 py-4 text-sm">
										<span
											className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
												run.status === 'complete'
													? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
													: run.status === 'failed'
														? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
														: run.status === 'cancelled'
															? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
															: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
											}`}
										>
											{run.status === 'running' && (
												<span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
											)}
											{run.status}
										</span>
									</td>
									<td className="px-4 py-4 text-sm text-gray-600 dark:text-neutral-400">
										{run.articles_scraped}
									</td>
									<td className="px-4 py-4 text-sm text-gray-600 dark:text-neutral-400">
										{run.articles_new}
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>

			{/* Pagination + rows-per-page */}
			<div className="mt-4 flex items-center justify-between">
				<div className="flex items-center gap-3">
					<label className="text-sm text-gray-500 dark:text-neutral-400">Rows</label>
					<select
						value={pageSize}
						onChange={(e) => handlePageSizeChange(Number(e.target.value))}
						className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-gray-700 dark:text-neutral-300 focus:border-indigo-500 focus:outline-none"
					>
						{ROW_OPTIONS.map((n) => (
							<option key={n} value={n}>
								{n}
							</option>
						))}
					</select>
					{total > 0 && (
						<p className="text-sm text-gray-500 dark:text-neutral-400">
							Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
						</p>
					)}
				</div>
				{totalPages > 1 && (
					<div className="flex items-center gap-2">
						<button
							onClick={() => setPage((p) => Math.max(1, p - 1))}
							disabled={page === 1}
							className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-neutral-300 transition hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-40"
						>
							Previous
						</button>
						<span className="text-sm text-gray-600 dark:text-neutral-400 tabular-nums">
							{page} / {totalPages}
						</span>
						<button
							onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
							disabled={page === totalPages}
							className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-neutral-300 transition hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-40"
						>
							Next
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

function SortHeader({
	label,
	sortKey,
	sorts,
	onSort
}: {
	label: string;
	sortKey: SortKey;
	sorts: SortSpec[];
	onSort: (key: SortKey, additive: boolean) => void;
}) {
	const idx = sorts.findIndex((s) => s.key === sortKey);
	const active = idx !== -1;
	const order = active ? sorts[idx].order : null;
	const showRank = sorts.length > 1 && active;
	return (
		<th
			onClick={(e) => onSort(sortKey, e.shiftKey)}
			title="Click to sort. Shift-click to add as a secondary sort."
			className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200 transition"
		>
			<span className="inline-flex items-center gap-1">
				{label}
				<svg
					className={`h-3 w-3 transition ${active ? 'opacity-100' : 'opacity-0'}`}
					viewBox="0 0 12 12"
					fill="currentColor"
				>
					{order === 'asc' ? <path d="M6 4L2 8h8L6 4z" /> : <path d="M6 8L2 4h8L6 8z" />}
				</svg>
				{showRank && (
					<span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900 px-1 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
						{idx + 1}
					</span>
				)}
			</span>
		</th>
	);
}
