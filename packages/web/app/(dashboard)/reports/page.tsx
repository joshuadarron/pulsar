'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Report {
	id: string;
	generated_at: string;
	article_count: number;
	executive_summary: string;
}

export default function ReportsPage() {
	const [reports, setReports] = useState<Report[]>([]);
	const [unreadRefs, setUnreadRefs] = useState<Set<string>>(new Set());

	useEffect(() => {
		fetch('/api/reports')
			.then((r) => r.json())
			.then(setReports);
		fetch('/api/notifications?refs=true')
			.then((r) => r.json())
			.then((data) => setUnreadRefs(new Set(data.referenceIds)));
	}, []);

	async function markAsRead(refId: string) {
		await fetch(`/api/notifications/${refId}?by=ref`, { method: 'PATCH' });
		setUnreadRefs((prev) => {
			const next = new Set(prev);
			next.delete(refId);
			return next;
		});
		window.dispatchEvent(new Event('notification-read'));
	}

	return (
		<div>
			<h1 className="text-2xl font-bold text-text-pri">Reports</h1>
			<p className="mt-1 text-text-muted">AI-generated trend reports from your data</p>

			<div className="mt-6">
				<div className="max-w-[37rem] space-y-4">
					{reports.length === 0 ? (
						<div className="rounded-lg border border-border bg-surface p-8 text-center text-text-dim">
							No reports generated yet. Run the pipeline to generate your first report.
						</div>
					) : (
						reports.map((report) => {
							const isNew = unreadRefs.has(report.id);
							return (
								<Link
									key={report.id}
									href={`/reports/${report.id}`}
									onClick={() => isNew && markAsRead(report.id)}
									className={`block rounded-lg border p-5 transition hover:shadow-sm ${
										isNew
											? 'border-accent/40 bg-accent-soft/40 shadow-sm'
											: 'border-border bg-surface hover:border-accent/40'
									}`}
								>
									<div className="flex items-center justify-between">
										<div>
											<div className="flex items-center gap-2">
												<p className="text-sm font-medium text-text-pri">
													Report — {new Date(report.generated_at).toLocaleDateString()}
												</p>
												{isNew && (
													<span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
														New
													</span>
												)}
											</div>
											<p className="mt-1 text-sm text-text-muted line-clamp-3">
												{report.executive_summary || 'No summary'}
											</p>
										</div>
										<div className="text-right">
											<p className="text-2xl font-bold text-accent">{report.article_count}</p>
											<p className="text-xs text-text-dim">articles</p>
										</div>
									</div>
								</Link>
							);
						})
					)}
				</div>
			</div>
		</div>
	);
}
