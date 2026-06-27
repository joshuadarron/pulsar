'use client';

import { useEffect, useState } from 'react';

interface ValidationCheck {
	check_name: string;
	passed: boolean;
	detail?: string;
}

interface Validation {
	id: string;
	pipeline_name: string;
	validated_at: string;
	passed: boolean;
	checks: ValidationCheck[];
	error_summary: string | null;
}

interface Evaluation {
	id: string;
	target_type: string;
	target_id: string | null;
	dimension: string;
	score: number | null;
	passed: boolean | null;
	rationale: string | null;
	judge_model: string;
	judged_at: string;
}

interface Prediction {
	id: string;
	report_id: string;
	prediction_text: string;
	predicted_entities: string[];
	predicted_topics: string[];
	prediction_type: string;
	extracted_at: string;
	outcome: string | null;
	evidence_summary: string | null;
	grade_judge_model: string | null;
}

interface Payload {
	validations: Validation[];
	evaluations: Evaluation[];
	predictions: Prediction[];
}

const OUTCOME_COLORS: Record<string, string> = {
	confirmed: 'bg-success/15 text-success border border-success/30',
	partially_confirmed: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
	refuted: 'bg-danger/15 text-danger border border-danger/30',
	inconclusive: 'bg-bg-alt text-text-sec border border-border'
};

export default function RunEvalsSection({ runId }: { runId: string }) {
	const [data, setData] = useState<Payload | null>(null);

	useEffect(() => {
		if (!runId) return;
		fetch(`/api/evals/${runId}`)
			.then(async (r) => {
				if (!r.ok) throw new Error(`status ${r.status}`);
				return r.json();
			})
			.then((d) => setData(d))
			.catch(() => setData(null));
	}, [runId]);

	if (!data) return null;

	const hasAny =
		data.validations.length > 0 || data.evaluations.length > 0 || data.predictions.length > 0;
	if (!hasAny) return null;

	const reportEvals = data.evaluations.filter((e) => e.target_type === 'trend_report');
	const draftEvals = data.evaluations.filter((e) => e.target_type === 'content_draft');
	const platforms = Array.from(new Set(draftEvals.map((e) => e.target_id ?? '')));

	return (
		<div className="mt-6 space-y-6">
			<h2 className="text-2xl font-bold text-text-pri">Evaluations</h2>

			{data.validations.length > 0 && (
				<section>
					<h3 className="mb-3 text-sm font-semibold uppercase text-text-muted">
						Pipeline validations
					</h3>
					<div className="space-y-3">
						{data.validations.map((v) => (
							<div key={v.id} className="rounded-lg border border-border bg-surface p-4">
								<div className="flex items-center justify-between">
									<p className="font-medium text-text-pri">{v.pipeline_name}</p>
									<span
										className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.passed ? 'bg-success/15 text-success border border-success/30' : 'bg-danger/15 text-danger border border-danger/30'}`}
									>
										{v.passed ? 'passed' : 'failed'}
									</span>
								</div>
								{v.error_summary && <p className="mt-2 text-xs text-danger">{v.error_summary}</p>}
								<ul className="mt-2 space-y-1 text-xs">
									{v.checks.map((c) => (
										<li key={c.check_name} className={c.passed ? 'text-text-sec' : 'text-danger'}>
											<span className="font-mono">{c.passed ? 'OK' : 'FAIL'}</span> {c.check_name}
											{c.detail && <span className="text-text-muted"> ({c.detail})</span>}
										</li>
									))}
								</ul>
							</div>
						))}
					</div>
				</section>
			)}

			{reportEvals.length > 0 && (
				<section>
					<h3 className="mb-3 text-sm font-semibold uppercase text-text-muted">
						Trend report scores
					</h3>
					<div className="overflow-x-auto rounded-lg border border-border bg-surface">
						<table className="w-full text-sm">
							<thead className="bg-bg-alt">
								<tr>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
										Dimension
									</th>
									<th className="px-4 py-3 text-right text-xs font-medium uppercase text-text-muted">
										Score
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
										Rationale
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
										Judge
									</th>
								</tr>
							</thead>
							<tbody>
								{reportEvals.map((e) => (
									<tr key={e.id} className="border-t border-border">
										<td className="px-4 py-3 font-medium text-text-pri">{e.dimension}</td>
										<td className="px-4 py-3 text-right tabular-nums">{e.score ?? 'n/a'} / 5</td>
										<td className="px-4 py-3 text-text-sec">{e.rationale ?? ''}</td>
										<td className="px-4 py-3 text-xs text-text-muted font-mono">{e.judge_model}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}

			{platforms.length > 0 && (
				<section>
					<h3 className="mb-3 text-sm font-semibold uppercase text-text-muted">
						Content draft scores
					</h3>
					<div className="space-y-4">
						{platforms.map((platform) => {
							const llm = draftEvals.filter(
								(e) => e.target_id === platform && !e.dimension.startsWith('subcheck_')
							);
							const sub = draftEvals.filter(
								(e) => e.target_id === platform && e.dimension.startsWith('subcheck_')
							);
							return (
								<div key={platform} className="rounded-lg border border-border bg-surface p-4">
									<p className="mb-3 font-medium text-text-pri">{platform}</p>
									{llm.length > 0 && (
										<div className="mb-3">
											<p className="mb-1 text-xs uppercase text-text-muted">LLM dimensions</p>
											<table className="w-full text-sm">
												<tbody>
													{llm.map((e) => (
														<tr key={e.id} className="border-b border-border last:border-0">
															<td className="py-1.5 pr-4 font-medium text-text-pri">
																{e.dimension}
															</td>
															<td className="py-1.5 pr-4 tabular-nums text-text-pri">
																{e.score ?? 'n/a'} / 5
															</td>
															<td className="py-1.5 text-xs text-text-sec">{e.rationale ?? ''}</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									)}
									{sub.length > 0 && (
										<div>
											<p className="mb-1 text-xs uppercase text-text-muted">Sub-checks</p>
											<ul className="space-y-1 text-xs">
												{sub.map((s) => (
													<li key={s.id} className={s.passed ? 'text-text-sec' : 'text-danger'}>
														<span className="font-mono">{s.passed ? 'OK' : 'FAIL'}</span>{' '}
														{s.dimension.replace(/^subcheck_/, '')}
														{s.rationale && (
															<span className="text-text-muted"> ({s.rationale})</span>
														)}
													</li>
												))}
											</ul>
										</div>
									)}
								</div>
							);
						})}
					</div>
				</section>
			)}

			{data.predictions.length > 0 && (
				<section>
					<h3 className="mb-3 text-sm font-semibold uppercase text-text-muted">
						Predictions extracted from this run
					</h3>
					<div className="space-y-3">
						{data.predictions.map((p) => (
							<div key={p.id} className="rounded-lg border border-border bg-surface p-4">
								<div className="flex items-start justify-between gap-4">
									<p className="text-text-pri">{p.prediction_text}</p>
									{p.outcome && (
										<span
											className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_COLORS[p.outcome] ?? OUTCOME_COLORS.inconclusive}`}
										>
											{p.outcome}
										</span>
									)}
								</div>
								<div className="mt-2 flex flex-wrap gap-2 text-xs text-text-muted">
									<span>type: {p.prediction_type}</span>
									{p.predicted_entities.length > 0 && (
										<span>entities: {p.predicted_entities.join(', ')}</span>
									)}
									{p.predicted_topics.length > 0 && (
										<span>topics: {p.predicted_topics.join(', ')}</span>
									)}
								</div>
								{p.evidence_summary && (
									<p className="mt-2 text-xs text-text-sec">
										<span className="font-medium">Evidence:</span> {p.evidence_summary}
										{p.grade_judge_model && (
											<span className="ml-2 font-mono text-text-dim">({p.grade_judge_model})</span>
										)}
									</p>
								)}
							</div>
						))}
					</div>
				</section>
			)}
		</div>
	);
}
