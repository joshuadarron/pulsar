'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Notification {
	id: string;
	type: string;
	title: string;
	message: string;
	link: string | null;
	read: boolean;
	created_at: string;
}

const TYPE_ICONS: Record<string, { icon: string; color: string }> = {
	pipeline: {
		icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
		color: 'text-violet-500'
	},
	report: {
		icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
		color: 'text-violet-500'
	},
	drafts: {
		icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
		color: 'text-amber-500'
	}
};

export default function NotificationsPage() {
	const [notifications, setNotifications] = useState<Notification[]>([]);

	useEffect(() => {
		fetch('/api/notifications')
			.then((r) => r.json())
			.then((data) => setNotifications(data.notifications));
	}, []);

	async function markAsRead(id: string) {
		await fetch(`/api/notifications/${id}`, { method: 'PATCH' });
		setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
		window.dispatchEvent(new Event('notification-read'));
	}

	return (
		<div>
			<h1 className="text-2xl font-bold text-gray-900 dark:text-neutral-100">Notifications</h1>
			<p className="mt-1 text-gray-500 dark:text-neutral-400">
				Pipeline reports and content generation alerts
			</p>

			<div className="mt-6 max-w-3xl space-y-3">
				{notifications.length === 0 ? (
					<div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-8 text-center text-gray-400 dark:text-neutral-500">
						No notifications yet. Notifications appear after pipeline runs complete.
					</div>
				) : (
					notifications.map((n) => {
						const cardClass = `block rounded-lg border p-4 transition cursor-pointer ${
							n.read
								? 'border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-indigo-300 hover:shadow-sm'
								: 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 shadow-sm'
						}`;
						const cardContent = (
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1">
									<h3 className="text-sm font-medium text-gray-900 dark:text-neutral-100">
										{n.title}
									</h3>
									<p className="mt-1 text-sm text-gray-500 dark:text-neutral-400 line-clamp-2">
										{n.message}
									</p>
									<div className="mt-2 flex flex-wrap gap-1.5">
										<span
											className={`rounded px-2 py-0.5 text-xs ${
												n.type === 'report'
													? 'bg-violet-50 text-violet-600 dark:bg-violet-900 dark:text-violet-300'
													: n.type === 'drafts'
														? 'bg-amber-50 text-amber-600 dark:bg-amber-900 dark:text-amber-300'
														: 'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-400'
											}`}
										>
											{n.type}
										</span>
										{!n.read && (
											<span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
												Unread
											</span>
										)}
									</div>
								</div>
								<div className="text-right flex-shrink-0">
									<p className="text-xs text-gray-400 dark:text-neutral-500">
										{new Date(n.created_at).toLocaleDateString()}
									</p>
									<p className="text-xs text-gray-400 dark:text-neutral-500">
										{new Date(n.created_at).toLocaleTimeString()}
									</p>
								</div>
							</div>
						);

						if (n.link) {
							return (
								<Link
									key={n.id}
									href={n.link}
									onClick={() => !n.read && markAsRead(n.id)}
									className={cardClass}
								>
									{cardContent}
								</Link>
							);
						}
						return (
							<div key={n.id} onClick={() => !n.read && markAsRead(n.id)} className={cardClass}>
								{cardContent}
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
