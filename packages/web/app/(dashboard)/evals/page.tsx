'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import EvalTrendChart from '@/components/report/EvalTrendChart';

interface RecentRun {
	run_id: string;
	started_at: string;
	completed_at: string | null;
	status: string;
	report_total: number | null;
	report_max: number | null;
	drafts_avg_llm: number | null;
	drafts_count: number;
	validations_passed: number;
	validations_failed: number;
}

interface ReportTrendPoint {
	judged_at: string;
	dimension: string;
	score: number;
}

interface DraftPlatformPass {
	platform: string;
	total: number;
	passed: number;
}

interface ValidationFailure {
	pipeline_name: string;
	failures: number;
}

interface Prediction {
	prediction_id: string;
	report_id: string;
	report_generated_at: string;
	prediction_text: string;
	predicted_entities: string[];
	predicted_topics: string[];
	prediction_type: string;
	outcome: string | null;
	evidence_summary: string | null;
	graded_at: string | null;
	status: string;
}

const OUTCOME_FILTERS = [
	'all',
	'pending',
	'confirmed',
	'partially_confirmed',
	'refuted',
	'inconclusive'
];

const OUTCOME_COLORS: Record<string, string> = {
	confirmed: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
	partially_confirmed: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
	refuted: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
	inconclusive: 'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-300',
	pending: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
};

export default function EvalsPage() {
	const [runs, setRuns] = useState<RecentRun[]>([]);
	const [reportTrend, setReportTrend] = useState<ReportTrendPoint[]>([]);
	const [draftPass, setDraftPass] = useState<DraftPlatformPass[]>([]);
	const [validationFailures, setValidationFailures] = useState<ValidationFailure[]>([]);
	const [predictions, setPredictions] = useState<Prediction[]>([]);
	const [outcomeFilter, setOutcomeFilter] = useState('all');
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		Promise.all([
			fetch('/api/evals?days=30').then((r) => r.json()),
			fetch('/api/evals/trends?days=90').then((r) => r.json())
		]).then(([recent, trends]) => {
			setRuns(recent.runs ?? []);
			setReportTrend(trends.reportTrend ?? []);
			setDraftPass(trends.draftPlatformPass ?? []);
			setValidationFailures(trends.validationFailures ?? []);
			setLoading(false);
		});
	}, []);

	useEffect(() => {
		const param = outcomeFilter === 'all' ? '' : `?outcome=${outcomeFilter}`;
		fetch(`/api/evals/predictions${param}`)
			.then((r) => r.json())
			.then((data) => setPredictions(data.predictions ?? []));
	}, [outcomeFilter]);

	if (loading) {
		return <div className="p-8 text-gray-500 dark:text-neutral-400">Loading evaluations...</div>;
	}

	return (
		<div className="space-y-8 p-8">
			<div>
				<h1 className="text-3xl font-bold text-gray-900 dark:text-neutral-100">Evaluations</h1>
				<p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
					Quality scores, structural validations, and predictions tracking.
				</p>
			</div>

			<section>
				<h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-neutral-100">
					Recent run quality (30 days)
				</h2>
				{runs.length === 0 ? (
					<div className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 text-sm text-gray-500 dark:text-neutral-400">
						No pipeline runs in this window yet.
					</div>
				) : (
					<div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
						<table className="w-full text-sm">
							<thead className="bg-gray-50 dark:bg-neutral-800">
								<tr>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Date
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Status
									</th>
									<th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Report
									</th>
									<th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Drafts avg
									</th>
									<th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Validations
									</th>
								</tr>
							</thead>
							<tbody>
								{runs.map((r) => (
									<tr
										key={r.run_id}
										className="border-t border-gray-100 dark:border-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-800"
									>
										<td className="px-4 py-3">
											<Link
												href={`/evals/${r.run_id}`}
												className="text-indigo-600 dark:text-indigo-400 hover:underline"
											>
												{new Date(r.started_at).toLocaleString()}
											</Link>
										</td>
										<td className="px-4 py-3 text-gray-600 dark:text-neutral-400">{r.status}</td>
										<td className="px-4 py-3 text-right tabular-nums">
											{r.report_total !== null && r.report_max !== null
												? `${r.report_total} / ${r.report_max}`
												: 'n/a'}
										</td>
										<td className="px-4 py-3 text-right tabular-nums">
											{r.drafts_avg_llm !== null
												? `${Number(r.drafts_avg_llm).toFixed(2)} (${r.drafts_count})`
												: 'n/a'}
										</td>
										<td className="px-4 py-3 text-right tabular-nums">
											<span className="text-green-600 dark:text-green-400">
												{r.validations_passed}
											</span>
											{' / '}
											<span
												className={
													r.validations_failed > 0
														? 'text-red-600 dark:text-red-400'
														: 'text-gray-400'
												}
											>
												{r.validations_failed}
											</span>
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
					Quality trends (90 days)
				</h2>
				<div className="grid gap-4 lg:grid-cols-2">
					<div className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
						<p className="mb-3 text-sm font-medium text-gray-700 dark:text-neutral-300">
							Trend report scores by dimension
						</p>
						<EvalTrendChart data={reportTrend} />
					</div>
					<div className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
						<p className="mb-3 text-sm font-medium text-gray-700 dark:text-neutral-300">
							Drafts sub-check pass rate (30 days)
						</p>
						{draftPass.length === 0 ? (
							<div className="flex h-64 items-center justify-center text-sm text-gray-400 dark:text-neutral-500">
								No draft sub-checks recorded yet.
							</div>
						) : (
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b border-gray-200 dark:border-neutral-700">
										<th className="pb-2 text-left text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">
											Platform
										</th>
										<th className="pb-2 text-right text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">
											Pass rate
										</th>
										<th className="pb-2 text-right text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">
											Pass / total
										</th>
									</tr>
								</thead>
								<tbody>
									{draftPass.map((d) => {
										const rate = d.total > 0 ? (d.passed / d.total) * 100 : 0;
										return (
											<tr
												key={d.platform}
												className="border-b border-gray-100 dark:border-neutral-800 last:border-0"
											>
												<td className="py-2 font-medium text-gray-900 dark:text-neutral-100">
													{d.platform}
												</td>
												<td className="py-2 text-right tabular-nums">{rate.toFixed(0)}%</td>
												<td className="py-2 text-right tabular-nums text-gray-600 dark:text-neutral-400">
													{d.passed} / {d.total}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						)}
					</div>
					<div className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 lg:col-span-2">
						<p className="mb-3 text-sm font-medium text-gray-700 dark:text-neutral-300">
							Validation failures by pipeline (30 days)
						</p>
						{validationFailures.length === 0 ? (
							<div className="flex h-24 items-center justify-center text-sm text-gray-400 dark:text-neutral-500">
								No validation failures, all pipelines healthy.
							</div>
						) : (
							<div className="space-y-2">
								{validationFailures.map((v) => (
									<div key={v.pipeline_name} className="flex items-center gap-3">
										<span className="w-48 text-sm text-gray-700 dark:text-neutral-300">
											{v.pipeline_name}
										</span>
										<div className="flex-1 rounded bg-gray-100 dark:bg-neutral-800">
											<div
												className="h-3 rounded bg-red-500"
												style={{ width: `${Math.min(100, v.failures * 10)}%` }}
											/>
										</div>
										<span className="w-12 text-right tabular-nums text-sm text-gray-700 dark:text-neutral-300">
											{v.failures}
										</span>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			</section>

			<section>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100">
						Predictions tracking
					</h2>
					<select
						value={outcomeFilter}
						onChange={(e) => setOutcomeFilter(e.target.value)}
						className="rounded-md border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm"
					>
						{OUTCOME_FILTERS.map((o) => (
							<option key={o} value={o}>
								{o}
							</option>
						))}
					</select>
				</div>
				{predictions.length === 0 ? (
					<div className="rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 text-sm text-gray-500 dark:text-neutral-400">
						No predictions match this filter.
					</div>
				) : (
					<div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
						<table className="w-full text-sm">
							<thead className="bg-gray-50 dark:bg-neutral-800">
								<tr>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Date
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Prediction
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Type
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Status
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-neutral-400">
										Evidence
									</th>
								</tr>
							</thead>
							<tbody>
								{predictions.map((p) => (
									<tr
										key={p.prediction_id}
										className="border-t border-gray-100 dark:border-neutral-800"
									>
										<td className="px-4 py-3 text-gray-600 dark:text-neutral-400">
											{new Date(p.report_generated_at).toLocaleDateString()}
										</td>
										<td className="px-4 py-3 max-w-xl text-gray-900 dark:text-neutral-100">
											{p.prediction_text}
										</td>
										<td className="px-4 py-3 text-xs text-gray-500 dark:text-neutral-400">
											{p.prediction_type}
										</td>
										<td className="px-4 py-3">
											<span
												className={`rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_COLORS[p.status] ?? OUTCOME_COLORS.inconclusive}`}
											>
												{p.status}
											</span>
										</td>
										<td className="px-4 py-3 max-w-md text-xs text-gray-600 dark:text-neutral-400">
											{p.evidence_summary ?? ''}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
}
