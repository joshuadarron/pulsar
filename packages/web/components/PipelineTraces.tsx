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
	begin: 'bg-info/15 text-info border border-info/30',
	enter: 'bg-bg-alt text-text-sec border border-border',
	leave: 'bg-bg-alt text-text-sec border border-border',
	end: 'bg-success/15 text-success border border-success/30'
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
		<div className="mt-4 rounded-lg border border-border bg-surface p-5">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold uppercase text-text-muted">Pipeline Traces</h2>
				<span className="text-xs text-text-dim">
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
						<div key={key} className="rounded-lg border border-border bg-bg">
							<button
								type="button"
								onClick={() => toggleGroup(key)}
								className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs"
							>
								<span className="flex items-center gap-2">
									<span className="font-mono text-text-muted">{isOpen ? '▾' : '▸'}</span>
									<span className="font-semibold text-text-pri">{g.pipeline}</span>
									<span className="text-text-muted">pipe {g.pipeId}</span>
									{errored && (
										<span className="rounded-full bg-danger/15 text-danger px-2 py-0.5 border border-danger/30">
											error
										</span>
									)}
								</span>
								<span className="text-text-dim">{g.rows.length} ops</span>
							</button>
							{isOpen && (
								<div className="border-t border-border p-2 font-mono text-xs">
									{g.rows.map((r) => {
										const full = details.get(r.id);
										const isExpanded = openRows.has(r.id);
										return (
											<div key={r.id} className="border-b border-border last:border-b-0">
												<button
													type="button"
													onClick={() => toggleRow(r.id)}
													className="flex w-full items-center gap-2 py-1 text-left hover:bg-gray-100 dark:hover:bg-neutral-900"
												>
													<span className="text-text-dim">{isExpanded ? '▾' : '▸'}</span>
													<span className="text-text-dim">
														{new Date(r.occurred_at).toLocaleTimeString()}
													</span>
													<span
														className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${OP_BADGE[r.op] ?? 'bg-bg-alt'}`}
													>
														{r.op}
													</span>
													<span className="text-text-sec">{r.component ?? 'unknown'}</span>
													{r.rr_seq !== null && (
														<span className="ml-auto text-text-dim">seq {r.rr_seq}</span>
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
															<span className="text-text-dim">Loading…</span>
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
		<details className="rounded bg-surface p-2 ring-1 ring-gray-200 dark:ring-neutral-800">
			<summary className="cursor-pointer text-text-muted">{label}</summary>
			<pre className="mt-2 max-h-[300px] overflow-auto whitespace-pre-wrap break-all text-text-pri">
				{JSON.stringify(value, null, 2)}
			</pre>
		</details>
	);
}
