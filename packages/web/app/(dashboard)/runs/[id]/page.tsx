'use client';

import PipelineTraces from '@/components/PipelineTraces';
import RunEvalsSection from '@/components/RunEvalsSection';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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

interface LogEntry {
	id: string;
	logged_at: string;
	level: string;
	stage: string;
	message: string;
	source: string | null;
	trace_id: string | null;
}

type SourceFilter = 'all' | 'pulsar' | 'rocketride';

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

const LEVEL_STYLES: Record<string, string> = {
	info: 'text-blue-600 dark:text-blue-400',
	warn: 'text-warning',
	error: 'text-danger',
	success: 'text-success'
};

const STATUS_BADGE: Record<string, string> = {
	running: 'bg-warning/15 text-warning border border-warning/30',
	complete: 'bg-success/15 text-success border border-success/30',
	failed: 'bg-danger/15 text-danger border border-danger/30',
	cancelled: 'bg-warning/15 text-warning border border-warning/30'
};

export default function RunDetailPage() {
	const { id } = useParams<{ id: string }>();
	const [run, setRun] = useState<Run | null>(null);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [duration, setDuration] = useState('');
	const [loading, setLoading] = useState(true);
	const [cancelling, setCancelling] = useState(false);
	const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
	const [logsCopied, setLogsCopied] = useState(false);
	const logPaneRef = useRef<HTMLDivElement>(null);

	// Fetch run data and poll while running
	useEffect(() => {
		const interval: ReturnType<typeof setInterval> = setInterval(fetchRun, 2000);

		async function fetchRun() {
			const res = await fetch(`/api/runs/${id}`);
			if (!res.ok) return;
			const data = await res.json();
			setRun(data.run);
			setLogs(data.logs);
			setLoading(false);

			// Stop polling once complete/failed
			if (data.run.status !== 'running') {
				clearInterval(interval);
			}
		}

		fetchRun();

		return () => clearInterval(interval);
	}, [id]);

	// Live duration ticker
	useEffect(() => {
		if (!run) return;

		function tick() {
			setDuration(formatDuration(run!.started_at, run!.completed_at));
		}
		tick();

		if (run.status === 'running') {
			const timer = setInterval(tick, 1000);
			return () => clearInterval(timer);
		}
	}, [run]);

	// Auto-scroll the log pane to the latest entry — operate on the pane's
	// own scrollTop so only the terminal view scrolls, not the whole page.
	useEffect(() => {
		const pane = logPaneRef.current;
		if (!pane) return;
		pane.scrollTop = pane.scrollHeight;
	}, [logs]);

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
			</div>
		);
	}

	if (!run) {
		return <p className="py-20 text-center text-text-dim">Run not found.</p>;
	}

	// Stage timeline derives from Pulsar-side logs only — RR stages are too
	// granular to be useful as phase badges and would dwarf the timeline.
	const pulsarLogs = logs.filter((l) => (l.source ?? 'pulsar') === 'pulsar');
	const stages = [...new Map(pulsarLogs.map((l) => [l.stage, l])).keys()];
	const stageStatus = (stage: string) => {
		const stageLogs = pulsarLogs.filter((l) => l.stage === stage);
		if (stageLogs.some((l) => l.level === 'error')) return 'error';
		if (stageLogs.some((l) => l.level === 'success')) return 'success';
		return 'running';
	};

	const filteredLogs =
		sourceFilter === 'all' ? logs : logs.filter((l) => (l.source ?? 'pulsar') === sourceFilter);
	const rrLogCount = logs.length - pulsarLogs.length;

	function copyLogsToClipboard() {
		if (typeof navigator === 'undefined' || !navigator.clipboard) return;
		const text = filteredLogs
			.map((log) => {
				const ts = new Date(log.logged_at).toLocaleTimeString();
				const level = log.level.toUpperCase().padEnd(7);
				return `${ts}  ${level}  [${log.stage}]  ${log.message}`;
			})
			.join('\n');
		navigator.clipboard.writeText(text).then(
			() => {
				setLogsCopied(true);
				setTimeout(() => setLogsCopied(false), 1500);
			},
			() => {
				setLogsCopied(false);
			}
		);
	}

	return (
		<div>
			{/* Header */}
			<div className="flex items-center gap-2 text-sm text-text-dim">
				<Link href="/runs" className="hover:text-gray-600 dark:hover:text-neutral-300">
					Run History
				</Link>
				<span>/</span>
				<span className="text-text-pri">{run.id.slice(0, 8)}</span>
			</div>

			<div className="mt-4 flex items-center justify-between">
				<div className="flex items-center gap-3">
					<h1 className="text-2xl font-bold text-text-pri">
						{run.run_type === 'scrape' ? 'Scrape' : 'Pipeline'} Run
					</h1>
					<span
						className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${STATUS_BADGE[run.status] || ''}`}
					>
						{run.status === 'running' && (
							<span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-warning" />
						)}
						{run.status}
					</span>
				</div>
				{run.status === 'running' && (
					<button
						onClick={async () => {
							setCancelling(true);
							await fetch(`/api/runs/${id}/cancel`, { method: 'POST' });
							setCancelling(false);
						}}
						disabled={cancelling}
						className="rounded-lg bg-danger px-4 py-1.5 text-sm font-medium text-white transition hover:bg-danger/90 disabled:opacity-50"
					>
						{cancelling ? 'Cancelling...' : 'Cancel Run'}
					</button>
				)}
			</div>
			<p className="mt-1 text-sm text-text-muted">
				Triggered {run.trigger} on {new Date(run.started_at).toLocaleString()}
			</p>

			{/* Stats */}
			<div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
				<StatTile label="Duration" value={duration} live={run.status === 'running'} />
				<StatTile label="Status" value={run.status} />
				<StatTile label="Articles Scraped" value={String(run.articles_scraped)} />
				<StatTile label="New Articles" value={String(run.articles_new)} />
			</div>

			{/* Stage Timeline */}
			{stages.length > 0 && (
				<div className="mt-6 rounded-lg border border-border bg-surface p-5">
					<h2 className="text-sm font-semibold uppercase text-text-muted">Stages</h2>
					<div className="mt-3 flex flex-wrap gap-2">
						{stages.map((stage) => {
							const s = stageStatus(stage);
							return (
								<span
									key={stage}
									className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
										s === 'success'
											? 'bg-success/15 text-success border border-success/30'
											: s === 'error'
												? 'bg-danger/15 text-danger border border-danger/30'
												: 'bg-warning/15 text-warning border border-warning/30'
									}`}
								>
									<span
										className={`h-1.5 w-1.5 rounded-full ${
											s === 'success'
												? 'bg-success'
												: s === 'error'
													? 'bg-danger'
													: 'bg-warning animate-pulse'
										}`}
									/>
									{stage}
								</span>
							);
						})}
					</div>
				</div>
			)}

			{/* Live Logs */}
			<div className="mt-4 rounded-lg border border-border bg-surface p-5">
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-3">
						<h2 className="text-sm font-semibold uppercase text-text-muted">Logs</h2>
						<div className="flex items-center gap-1 rounded-md bg-bg-alt p-0.5 text-xs">
							{(['all', 'pulsar', 'rocketride'] as const).map((opt) => (
								<button
									type="button"
									key={opt}
									onClick={() => setSourceFilter(opt)}
									className={`rounded px-2 py-0.5 capitalize transition ${
										sourceFilter === opt
											? 'bg-surface text-text-pri shadow-sm'
											: 'text-text-muted hover:text-gray-700 dark:hover:text-neutral-200'
									}`}
								>
									{opt === 'rocketride' ? `RocketRide${rrLogCount ? ` (${rrLogCount})` : ''}` : opt}
								</button>
							))}
						</div>
					</div>
					<div className="flex items-center gap-3">
						{run.status === 'running' && (
							<span className="flex items-center gap-1.5 text-xs text-warning">
								<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
								Live
							</span>
						)}
						<button
							type="button"
							onClick={copyLogsToClipboard}
							disabled={filteredLogs.length === 0}
							className="rounded-md border border-border bg-surface p-1.5 text-text-pri hover:bg-gray-50 dark:hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
							title={logsCopied ? 'Copied' : 'Copy visible log lines to clipboard'}
							aria-label={logsCopied ? 'Copied' : 'Copy visible log lines to clipboard'}
						>
							{logsCopied ? (
								<svg
									className="h-4 w-4 text-success"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									strokeWidth={2}
									aria-hidden="true"
								>
									<path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
								</svg>
							) : (
								<svg
									className="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									strokeWidth={1.5}
									aria-hidden="true"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
									/>
								</svg>
							)}
						</button>
					</div>
				</div>
				<div
					ref={logPaneRef}
					className="mt-3 max-h-[70vh] overflow-y-auto rounded-lg bg-bg p-4 font-mono text-xs"
				>
					{filteredLogs.length === 0 ? (
						<p className="text-text-dim">No log entries yet.</p>
					) : (
						filteredLogs.map((log) => {
							const isRr = (log.source ?? 'pulsar') === 'rocketride';
							return (
								<div
									key={log.id}
									className={`flex gap-3 py-0.5 ${
										isRr ? 'border-l-2 border-accent/40 pl-2 -ml-2' : ''
									}`}
								>
									<span className="flex-shrink-0 text-text-dim">
										{new Date(log.logged_at).toLocaleTimeString()}
									</span>
									<span
										className={`flex-shrink-0 w-14 text-right uppercase ${LEVEL_STYLES[log.level] || ''}`}
									>
										{log.level}
									</span>
									<span
										className={`flex-shrink-0 w-40 truncate ${
											isRr ? 'text-accent' : 'text-text-muted'
										}`}
									>
										[{log.stage}]
									</span>
									<span className="text-text-pri">{log.message}</span>
								</div>
							);
						})
					)}
				</div>
			</div>

			{/* Error Log */}
			{run.error_log && (
				<div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-5">
					<h2 className="text-sm font-semibold text-danger">Error Log</h2>
					<pre className="mt-2 whitespace-pre-wrap text-xs text-danger">{run.error_log}</pre>
				</div>
			)}

			<PipelineTraces runId={id} />
			<RunEvalsSection runId={id} />
		</div>
	);
}

const STAT_ICONS: Record<string, { path: string; accent: string; bg: string; ring: string }> = {
	Duration: {
		path: 'M12 6v6l4 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z',
		accent: 'text-accent',
		bg: 'bg-accent-soft',
		ring: 'ring-accent/20'
	},
	Status: {
		path: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
		accent: 'text-violet-600 dark:text-violet-400',
		bg: 'bg-violet-50 dark:bg-violet-950',
		ring: 'ring-violet-500/20 dark:ring-violet-400/20'
	},
	'Articles Scraped': {
		path: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z',
		accent: 'text-amber-600 dark:text-amber-400',
		bg: 'bg-amber-50 dark:bg-amber-950',
		ring: 'ring-amber-500/20 dark:ring-amber-400/20'
	},
	'New Articles': {
		path: 'M12 4v16m8-8H4',
		accent: 'text-success',
		bg: 'bg-success/10',
		ring: 'ring-green-500/20 dark:ring-green-400/20'
	}
};

function StatTile({ label, value, live }: { label: string; value: string; live?: boolean }) {
	const icon = STAT_ICONS[label] || STAT_ICONS.Duration;
	return (
		<div className="flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-surface p-5">
			<div className="flex items-center gap-3">
				<div
					className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${icon.bg} ring-1 ${icon.ring}`}
				>
					<svg
						className={`h-5 w-5 ${icon.accent}`}
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={1.5}
					>
						<path strokeLinecap="round" strokeLinejoin="round" d={icon.path} />
					</svg>
				</div>
				<p className="text-xs font-medium uppercase tracking-wide text-text-dim">{label}</p>
			</div>
			<div className="mt-3 flex items-baseline gap-2">
				<span className="text-3xl font-bold tabular-nums text-text-pri">{value}</span>
				{live && <span className="h-2 w-2 animate-pulse rounded-full bg-warning" />}
			</div>
		</div>
	);
}
