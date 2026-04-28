'use client';

import { useState, useEffect } from 'react';

interface Draft {
	id: string;
	report_id: string;
	platform: string;
	content_type: string;
	body: string;
	status: string;
	created_at: string;
}

const PLATFORMS = [
	'all',
	'hashnode',
	'medium',
	'devto',
	'hackernews',
	'linkedin',
	'twitter',
	'discord'
];

export default function DraftsPage() {
	const [drafts, setDrafts] = useState<Draft[]>([]);
	const [filter, setFilter] = useState('all');
	const [selected, setSelected] = useState<Draft | null>(null);
	const [unreadRefs, setUnreadRefs] = useState<Set<string>>(new Set());

	useEffect(() => {
		fetch('/api/notifications?refs=true')
			.then((r) => r.json())
			.then((data) => setUnreadRefs(new Set(data.referenceIds)));
	}, []);

	useEffect(() => {
		const params = filter !== 'all' ? `?platform=${filter}` : '';
		fetch(`/api/drafts${params}`)
			.then((r) => r.json())
			.then(setDrafts);
	}, [filter]);

	async function markAsRead(refId: string) {
		await fetch(`/api/notifications/${refId}?by=ref`, { method: 'PATCH' });
		setUnreadRefs((prev) => {
			const next = new Set(prev);
			next.delete(refId);
			return next;
		});
		window.dispatchEvent(new Event('notification-read'));
	}

	async function updateStatus(id: string, status: string) {
		await fetch(`/api/drafts/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status })
		});
		setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)));
	}

	function selectDraft(draft: Draft) {
		setSelected(draft);
		if (draft.report_id && unreadRefs.has(draft.report_id)) {
			markAsRead(draft.report_id);
		}
	}

	return (
		<div>
			<h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Content Drafts</h1>
			<p className="mt-1 text-gray-500 dark:text-neutral-400">
				AI-generated content ready for review
			</p>

			<div className="mt-4 flex gap-2">
				{PLATFORMS.map((p) => (
					<button
						key={p}
						onClick={() => setFilter(p)}
						className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${
							filter === p
								? 'bg-indigo-600 text-white'
								: 'bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-neutral-400 hover:bg-gray-200 dark:hover:bg-neutral-700'
						}`}
					>
						{p}
					</button>
				))}
			</div>

			<div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
				<div className="max-w-3xl space-y-3">
					{drafts.length === 0 ? (
						<p className="text-gray-400 dark:text-neutral-500">No drafts found.</p>
					) : (
						drafts.map((draft) => {
							const isNew = draft.report_id && unreadRefs.has(draft.report_id);
							return (
								<button
									key={draft.id}
									onClick={() => selectDraft(draft)}
									className={`w-full rounded-lg border p-4 text-left transition ${
										selected?.id === draft.id
											? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
											: isNew
												? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 shadow-sm'
												: 'border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-gray-300 dark:hover:border-neutral-600'
									}`}
								>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium capitalize text-gray-900 dark:text-neutral-100">
												{draft.platform}
											</span>
											{isNew && (
												<span className="inline-flex items-center rounded-full bg-indigo-100 dark:bg-indigo-900 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
													New
												</span>
											)}
										</div>
										<span
											className={`rounded-full px-2 py-0.5 text-xs font-medium ${
												draft.status === 'approved'
													? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
													: draft.status === 'exported'
														? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
														: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
											}`}
										>
											{draft.status}
										</span>
									</div>
									<p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">
										{draft.content_type} — {new Date(draft.created_at).toLocaleDateString()}
									</p>
									<p className="mt-2 line-clamp-2 text-sm text-gray-600 dark:text-neutral-400">
										{draft.body.slice(0, 120)}...
									</p>
								</button>
							);
						})
					)}
				</div>

				{selected && (
					<div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-semibold capitalize text-gray-900 dark:text-neutral-100">
								{selected.platform} — {selected.content_type}
							</h3>
							<div className="flex gap-2">
								{selected.status === 'draft' && (
									<button
										onClick={() => updateStatus(selected.id, 'approved')}
										className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
									>
										Approve
									</button>
								)}
								{selected.status === 'approved' && (
									<button
										onClick={() => updateStatus(selected.id, 'exported')}
										className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
									>
										Mark Exported
									</button>
								)}
							</div>
						</div>
						<div className="mt-4 max-h-[60vh] overflow-y-auto">
							<pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-neutral-300 leading-relaxed">
								{selected.body}
							</pre>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
