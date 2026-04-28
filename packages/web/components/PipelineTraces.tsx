'use client';

import { useEffect, useState } from 'react';

interface TraceRow {
	id: string;
	pipeline: string;
	pipe_id: number;
	op: string;
	component: string | null;
	occurred_at: string;
	rr_seq: number | null;
}

interface FullTrace extends TraceRow {
	rr_token: string | null;
	trace: Record<string, unknown>;
	result: unknown;
}

interface PipeGroup {
	pipeline: string;
	pipeId: number;
	rows: TraceRow[];
}

const OP_BADGE: Record<string, string> = {
	begin: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
	enter: 'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-300',
	leave: 'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-300',
	end: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
};

export default function PipelineTraces({ runId }: { runId: string }) {
	const [traces, setTraces] = useState<TraceRow[]>([]);
	const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
	const [openRows, setOpenRows] = useState<Set<string>>(new Set());
	const [details, setDetails] = useState<Map<string, FullTrace>>(new Map());

	useEffect(() => {
		if (!runId) return;
		fetch(`/api/runs/${runId}/traces`)
			.then((r) => (r.ok ? r.json() : { traces: [] }))
			.then((d) => setTraces(d.traces ?? []))
			.catch(() => setTraces([]));
	}, [runId]);

	if (traces.length === 0) return null;

	const groups = new Map<string, PipeGroup>();
	for (const t of traces) {
		const key = `${t.pipeline}|${t.pipe_id}`;
		let g = groups.get(key);
		if (!g) {
			g = { pipeline: t.pipeline, pipeId: t.pipe_id, rows: [] };
			groups.set(key, g);
		}
		g.rows.push(t);
	}
	const groupList = [...groups.values()];

	function toggleGroup(key: string) {
		const next = new Set(openGroups);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setOpenGroups(next);
	}

	async function toggleRow(rowId: string) {
		const next = new Set(openRows);
		if (next.has(rowId)) {
			next.delete(rowId);
			setOpenRows(next);
			return;
		}
		next.add(rowId);
		setOpenRows(next);
		if (!details.has(rowId)) {
			try {
				const res = await fetch(`/api/runs/${runId}/traces?id=${rowId}`);
				if (!res.ok) return;
				const data = await res.json();
				if (data.trace) {
					const m = new Map(details);
					m.set(rowId, data.trace);
					setDetails(m);
				}
			} catch {
				// ignore — leave row collapsed-with-spinner state to caller
			}
		}
	}

	return (
		<div className="mt-4 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold uppercase text-gray-500 dark:text-neutral-400">
					Pipeline Traces
				</h2>
				<span className="text-xs text-gray-400 dark:text-neutral-500">
					{traces.length} ops across {groups.size} pipes
				</span>
			</div>
			<div className="mt-3 space-y-2">
				{groupList.map((g) => {
					const key = `${g.pipeline}|${g.pipeId}`;
					const isOpen = openGroups.has(key);
					const errored = g.rows.some((r) => {
						const full = details.get(r.id);
						return typeof full?.trace?.error === 'string';
					});
					return (
						<div
							key={key}
							className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-950"
						>
							<button
								type="button"
								onClick={() => toggleGroup(key)}
								className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs"
							>
								<span className="flex items-center gap-2">
									<span className="font-mono text-gray-500 dark:text-neutral-500">
										{isOpen ? '▾' : '▸'}
									</span>
									<span className="font-semibold text-gray-800 dark:text-neutral-200">
										{g.pipeline}
									</span>
									<span className="text-gray-500 dark:text-neutral-500">pipe {g.pipeId}</span>
									{errored && (
										<span className="rounded-full bg-red-100 dark:bg-red-900 px-2 py-0.5 text-red-700 dark:text-red-300">
											error
										</span>
									)}
								</span>
								<span className="text-gray-400 dark:text-neutral-500">{g.rows.length} ops</span>
							</button>
							{isOpen && (
								<div className="border-t border-gray-200 dark:border-neutral-800 p-2 font-mono text-xs">
									{g.rows.map((r) => {
										const full = details.get(r.id);
										const isExpanded = openRows.has(r.id);
										return (
											<div
												key={r.id}
												className="border-b border-gray-100 dark:border-neutral-800 last:border-b-0"
											>
												<button
													type="button"
													onClick={() => toggleRow(r.id)}
													className="flex w-full items-center gap-2 py-1 text-left hover:bg-gray-100 dark:hover:bg-neutral-900"
												>
													<span className="text-gray-400 dark:text-neutral-600">
														{isExpanded ? '▾' : '▸'}
													</span>
													<span className="text-gray-400 dark:text-neutral-600">
														{new Date(r.occurred_at).toLocaleTimeString()}
													</span>
													<span
														className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${OP_BADGE[r.op] ?? 'bg-gray-100 dark:bg-neutral-800'}`}
													>
														{r.op}
													</span>
													<span className="text-gray-600 dark:text-neutral-400">
														{r.component ?? 'unknown'}
													</span>
													{r.rr_seq !== null && (
														<span className="ml-auto text-gray-400 dark:text-neutral-600">
															seq {r.rr_seq}
														</span>
													)}
												</button>
												{isExpanded && (
													<div className="ml-6 mb-2 space-y-1 text-[11px]">
														{full ? (
															<>
																{Object.keys(full.trace ?? {}).length > 0 && (
																	<JsonBlock label="trace" value={full.trace} />
																)}
																{full.result !== null && (
																	<JsonBlock label="result" value={full.result} />
																)}
															</>
														) : (
															<span className="text-gray-400 dark:text-neutral-500">Loading…</span>
														)}
													</div>
												)}
											</div>
										);
									})}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
	return (
		<details className="rounded bg-white dark:bg-neutral-900 p-2 ring-1 ring-gray-200 dark:ring-neutral-800">
			<summary className="cursor-pointer text-gray-500 dark:text-neutral-500">{label}</summary>
			<pre className="mt-2 max-h-[300px] overflow-auto whitespace-pre-wrap break-all text-gray-700 dark:text-neutral-300">
				{JSON.stringify(value, null, 2)}
			</pre>
		</details>
	);
}
