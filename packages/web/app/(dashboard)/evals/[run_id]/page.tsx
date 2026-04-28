'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Run {
	id: string;
	started_at: string;
	completed_at: string | null;
	status: string;
	run_type: string;
	trigger: string;
}

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
	run: Run;
	validations: Validation[];
	evaluations: Evaluation[];
	predictions: Prediction[];
}

const OUTCOME_COLORS: Record<string, string> = {
	confirmed: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
	partially_confirmed: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
	refuted: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
	inconclusive: 'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-300'
};

export default function EvalDetailPage() {
	const params = useParams();
	const runId = params?.run_id as string | undefined;
	const [data, setData] = useState<Payload | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!runId) return;
		fetch(`/api/evals/${runId}`)
			.then(async (r) => {
				if (!r.ok) throw new Error(`status ${r.status}`);
				return r.json();
			})
			.then((d) => setData(d))
			.catch((e) => setError(String(e)));
	}, [runId]);

	if (error) return <div className="p-8 text-red-600">Failed to load: {error}</div>;
	if (!data) return <div className="p-8 text-gray-500">Loading...</div>;

	const reportEvals = data.evaluations.filter((e) => e.target_type === 'trend_report');
	const draftEvals = data.evaluations.filter((e) => e.target_type === 'content_draft');

	const platforms = Array.from(new Set(draftEvals.map((e) => e.target_id ?? '')));

	return (
		<div className="space-y-8 p-8">
			<div>
				<Link
					href="/evals"
					className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
				>
					&larr; All evaluations
				</Link>
				<h1 className="mt-2 text-3xl font-bold text-gray-900 dark:text-neutral-100">
					Run {data.run.id.slice(0, 8)}
				</h1>
				<p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
					{new Date(data.run.started_at).toLocaleString()}, status: {data.run.status}, trigger:{' '}
					{data.run.trigger}
				</p>
			</div>

			<section>
				<h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-neutral-100">
					Pipeline validations
				</h2>
				{data.validations.length === 0 ? (
					<div className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 text-sm text-gray-500">
						No validation results recorded.
					</div>
				) : (
					<div className="space-y-3">
						{data.validations.map((v) => (
							<div
								key={v.id}
								className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4"
							>
								<div className="flex items-center justify-between">
									<p className="font-medium text-gray-900 dark:text-neutral-100">
										{v.pipeline_name}
									</p>
									<span
										className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.passed ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'}`}
									>
										{v.passed ? 'passed' : 'failed'}
									</span>
								</div>
								{v.error_summary && (
									<p className="mt-2 text-xs text-red-600 dark:text-red-400">{v.error_summary}</p>
								)}
								<ul className="mt-2 space-y-1 text-xs">
									{v.checks.map((c) => (
										<li
											key={c.check_name}
											className={
												c.passed
													? 'text-gray-600 dark:text-neutral-400'
													: 'text-red-600 dark:text-red-400'
											}
										>
											<span className="font-mono">{c.passed ? 'OK' : 'FAIL'}</span> {c.check_name}
											{c.detail && (
												<span className="text-gray-500 dark:text-neutral-500"> ({c.detail})</span>
											)}
										</li>
									))}
								</ul>
							</div>
						))}
					</div>
				)}
			</section>

			<section>
				<h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-neutral-100">
					Trend report scores
				</h2>
				{reportEvals.length === 0 ? (
					<div className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 text-sm text-gray-500">
						No trend report evaluations recorded.
					</div>
				) : (
					<div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
						<table className="w-full text-sm">
							<thead className="bg-gray-50 dark:bg-neutral-800">
								<tr>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Dimension
									</th>
									<th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Score
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Rationale
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Judge
									</th>
								</tr>
							</thead>
							<tbody>
								{reportEvals.map((e) => (
									<tr key={e.id} className="border-t border-gray-100 dark:border-neutral-800">
										<td className="px-4 py-3 font-medium text-gray-900 dark:text-neutral-100">
											{e.dimension}
										</td>
										<td className="px-4 py-3 text-right tabular-nums">{e.score ?? 'n/a'} / 5</td>
										<td className="px-4 py-3 text-gray-600 dark:text-neutral-400">
											{e.rationale ?? ''}
										</td>
										<td className="px-4 py-3 text-xs text-gray-500 dark:text-neutral-500 font-mono">
											{e.judge_model}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section>
				<h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-neutral-100">
					Content draft scores
				</h2>
				{platforms.length === 0 ? (
					<div className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 text-sm text-gray-500">
						No draft evaluations recorded.
					</div>
				) : (
					<div className="space-y-4">
						{platforms.map((platform) => {
							const llm = draftEvals.filter(
								(e) => e.target_id === platform && !e.dimension.startsWith('subcheck_')
							);
							const sub = draftEvals.filter(
								(e) => e.target_id === platform && e.dimension.startsWith('subcheck_')
							);
							return (
								<div
									key={platform}
									className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4"
								>
									<p className="mb-3 font-medium text-gray-900 dark:text-neutral-100">{platform}</p>
									{llm.length > 0 && (
										<div className="mb-3">
											<p className="mb-1 text-xs uppercase text-gray-500 dark:text-neutral-400">
												LLM dimensions
											</p>
											<table className="w-full text-sm">
												<tbody>
													{llm.map((e) => (
														<tr
															key={e.id}
															className="border-b border-gray-100 dark:border-neutral-800 last:border-0"
														>
															<td className="py-1.5 pr-4 font-medium text-gray-900 dark:text-neutral-100">
																{e.dimension}
															</td>
															<td className="py-1.5 pr-4 tabular-nums text-gray-700 dark:text-neutral-300">
																{e.score ?? 'n/a'} / 5
															</td>
															<td className="py-1.5 text-xs text-gray-600 dark:text-neutral-400">
																{e.rationale ?? ''}
															</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									)}
									{sub.length > 0 && (
										<div>
											<p className="mb-1 text-xs uppercase text-gray-500 dark:text-neutral-400">
												Sub-checks
											</p>
											<ul className="space-y-1 text-xs">
												{sub.map((s) => (
													<li
														key={s.id}
														className={
															s.passed
																? 'text-gray-600 dark:text-neutral-400'
																: 'text-red-600 dark:text-red-400'
														}
													>
														<span className="font-mono">{s.passed ? 'OK' : 'FAIL'}</span>{' '}
														{s.dimension.replace(/^subcheck_/, '')}
														{s.rationale && (
															<span className="text-gray-500 dark:text-neutral-500">
																{' '}
																({s.rationale})
															</span>
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
				)}
			</section>

			<section>
				<h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-neutral-100">
					Predictions extracted from this run
				</h2>
				{data.predictions.length === 0 ? (
					<div className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 text-sm text-gray-500">
						No predictions extracted.
					</div>
				) : (
					<div className="space-y-3">
						{data.predictions.map((p) => (
							<div
								key={p.id}
								className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4"
							>
								<div className="flex items-start justify-between gap-4">
									<p className="text-gray-900 dark:text-neutral-100">{p.prediction_text}</p>
									{p.outcome && (
										<span
											className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_COLORS[p.outcome] ?? OUTCOME_COLORS.inconclusive}`}
										>
											{p.outcome}
										</span>
									)}
								</div>
								<div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-neutral-400">
									<span>type: {p.prediction_type}</span>
									{p.predicted_entities.length > 0 && (
										<span>entities: {p.predicted_entities.join(', ')}</span>
									)}
									{p.predicted_topics.length > 0 && (
										<span>topics: {p.predicted_topics.join(', ')}</span>
									)}
								</div>
								{p.evidence_summary && (
									<p className="mt-2 text-xs text-gray-600 dark:text-neutral-400">
										<span className="font-medium">Evidence:</span> {p.evidence_summary}
										{p.grade_judge_model && (
											<span className="ml-2 font-mono text-gray-400 dark:text-neutral-500">
												({p.grade_judge_model})
											</span>
										)}
									</p>
								)}
							</div>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
