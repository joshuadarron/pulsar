'use client';

// This component is retained for backward compatibility with old report data.
// New reports use content_recommendations.text (rendered as paragraphs in ReportView).

interface ContentOpportunity {
	signal: string;
	source: string;
	url: string;
}

export default function OpportunityCards({ data }: { data: ContentOpportunity[] }) {
	if (data.length === 0) {
		return (
			<p className="text-sm text-gray-400 dark:text-neutral-500">
				No opportunities identified this period.
			</p>
		);
	}

	return (
		<div className="space-y-3">
			{data.map((opp, i) => (
				<div
					key={i}
					className="rounded-lg border border-gray-200 dark:border-neutral-700 border-l-4 border-l-indigo-500 bg-white dark:bg-neutral-800 p-4"
				>
					<div className="flex items-start gap-3">
						<span className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900 text-xs font-bold text-indigo-700 dark:text-indigo-300">
							{i + 1}
						</span>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-gray-900 dark:text-neutral-100">
								{opp.signal}
							</p>
							<div className="mt-2 flex items-center gap-3">
								<span className="text-xs text-gray-500 dark:text-neutral-400">{opp.source}</span>
								{opp.url && (
									<a
										href={opp.url}
										target="_blank"
										rel="noopener noreferrer"
										className="rounded bg-indigo-50 dark:bg-indigo-950 px-3 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900"
									>
										View source
									</a>
								)}
							</div>
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
