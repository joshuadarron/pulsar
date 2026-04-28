'use client';

import type { TrendingKeyword } from '@pulsar/shared/types';

export default function KeywordsChart({ data }: { data: TrendingKeyword[] }) {
	const items = data.slice(0, 10);
	if (items.length === 0) return null;

	return (
		<div>
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b border-gray-200 dark:border-neutral-700">
						<th className="pb-2 text-left text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">
							Keyword
						</th>
						<th className="pb-2 text-right text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">
							7d
						</th>
						<th className="pb-2 text-right text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">
							30d
						</th>
						<th className="pb-2 text-right text-xs font-medium uppercase text-gray-400 dark:text-neutral-500">
							Trend
						</th>
					</tr>
				</thead>
				<tbody>
					{items.map((k) => {
						const arrow = k.delta > 0 ? '\u25B2' : k.delta < 0 ? '\u25BC' : '\u2014';
						const arrowColor =
							k.delta > 0
								? 'text-green-600 dark:text-green-400'
								: k.delta < 0
									? 'text-red-600 dark:text-red-400'
									: 'text-gray-400 dark:text-neutral-500';
						return (
							<tr
								key={k.keyword}
								className="border-b border-gray-100 dark:border-neutral-800 last:border-0"
							>
								<td className="py-2 font-medium text-gray-900 dark:text-neutral-100">
									{k.keyword}
								</td>
								<td className="py-2 text-right tabular-nums text-gray-700 dark:text-neutral-300">
									{k.count7d}
								</td>
								<td className="py-2 text-right tabular-nums text-gray-700 dark:text-neutral-300">
									{k.count30d}
								</td>
								<td className={`py-2 text-right ${arrowColor}`}>{arrow}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			<p className="mt-2 text-xs text-gray-400 dark:text-neutral-500 italic">
				Top keywords by 7-day and 30-day mention volume across all tracked sources.
			</p>
		</div>
	);
}
