'use client';

import { useTheme } from '@/components/ThemeProvider';
import {
	arxivCategories,
	githubSearchQueries,
	hashnodeTag,
	mediumTags,
	redditSubreddits,
	rssSources,
	substackPublications
} from '@pulsar/shared/config/sources';
import { useEffect, useState } from 'react';

interface Subscriber {
	id: string;
	email: string;
	name: string | null;
	active: boolean;
	created_at: string;
}

interface Schedule {
	id: string;
	type: 'scrape' | 'pipeline';
	hour: number;
	minute: number;
	days: number[];
	active: boolean;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS = [1, 2, 3, 4, 5];

export default function SettingsPage() {
	const { theme, toggle } = useTheme();
	const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
	const [newEmail, setNewEmail] = useState('');
	const [newName, setNewName] = useState('');
	const [subError, setSubError] = useState('');
	const [schedules, setSchedules] = useState<Schedule[]>([]);
	const [scheduleError, setScheduleError] = useState('');
	const [disabledSources, setDisabledSources] = useState<Set<string>>(new Set());

	useEffect(() => {
		fetch('/api/subscribers')
			.then((r) => r.json())
			.then((d) => setSubscribers(d.subscribers));
		fetch('/api/settings/sources')
			.then((r) => r.json())
			.then((d) => setDisabledSources(new Set(d.disabled)));
		fetchSchedules();
	}, []);

	async function toggleSource(name: string) {
		const next = new Set(disabledSources);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		setDisabledSources(next);
		await fetch('/api/settings/sources', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ disabled: [...next] })
		});
	}

	function fetchSchedules() {
		fetch('/api/settings/schedule')
			.then((r) => r.json())
			.then((d) => setSchedules(d.schedules));
	}

	async function addSchedule(type: 'scrape' | 'pipeline') {
		setScheduleError('');
		const res = await fetch('/api/settings/schedule', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type, hour: 6, minute: 0, days: WEEKDAYS })
		});
		if (!res.ok) {
			const data = await res.json();
			setScheduleError(data.error || 'Failed to add schedule');
			return;
		}
		fetchSchedules();
	}

	async function updateSchedule(
		id: string,
		updates: Partial<Pick<Schedule, 'hour' | 'minute' | 'days' | 'active'>>
	) {
		setScheduleError('');
		const res = await fetch('/api/settings/schedule', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id, ...updates })
		});
		if (!res.ok) {
			const data = await res.json();
			setScheduleError(data.error || 'Failed to update schedule');
			fetchSchedules();
			return;
		}
		setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
	}

	async function removeSchedule(id: string) {
		await fetch(`/api/settings/schedule?id=${id}`, { method: 'DELETE' });
		setSchedules((prev) => prev.filter((s) => s.id !== id));
	}

	async function addSubscriber() {
		setSubError('');
		const res = await fetch('/api/subscribers', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: newEmail, name: newName })
		});
		if (!res.ok) {
			const data = await res.json();
			setSubError(data.error || 'Failed to add');
			return;
		}
		setNewEmail('');
		setNewName('');
		const refreshed = await fetch('/api/subscribers').then((r) => r.json());
		setSubscribers(refreshed.subscribers);
	}

	async function toggleSubscriber(id: string, active: boolean) {
		await fetch('/api/subscribers', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id, active })
		});
		setSubscribers((prev) => prev.map((s) => (s.id === id ? { ...s, active } : s)));
	}

	async function removeSubscriber(id: string) {
		await fetch(`/api/subscribers?id=${id}`, { method: 'DELETE' });
		setSubscribers((prev) => prev.filter((s) => s.id !== id));
	}

	const scrapeSchedules = schedules.filter((s) => s.type === 'scrape');
	const pipelineSchedules = schedules.filter((s) => s.type === 'pipeline');

	return (
		<div>
			<h1 className="text-2xl font-bold text-text-pri">Settings</h1>
			<p className="mt-1 text-text-muted">Configuration overview</p>

			{/* Appearance */}
			<section className="mt-8">
				<h2 className="text-lg font-semibold text-text-pri">Appearance</h2>
				<div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-surface p-4 lg:w-[calc(50%-0.5rem)]">
					<div className="flex items-center gap-3">
						{theme === 'dark' ? (
							<svg
								className="h-5 w-5 text-warning"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								strokeWidth={1.5}
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
								/>
							</svg>
						) : (
							<svg
								className="h-5 w-5 text-warning"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								strokeWidth={1.5}
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
								/>
							</svg>
						)}
						<div>
							<p className="text-sm font-medium text-text-pri">Dark Mode</p>
							<p className="text-xs text-text-muted">
								{theme === 'dark' ? 'Dark theme is active' : 'Light theme is active'}
							</p>
						</div>
					</div>
					<button
						onClick={toggle}
						role="switch"
						aria-checked={theme === 'dark'}
						className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
							theme === 'dark' ? 'bg-accent' : 'bg-border'
						}`}
					>
						<span
							className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
								theme === 'dark' ? 'translate-x-5' : 'translate-x-0.5'
							} mt-0.5`}
						/>
					</button>
				</div>
			</section>

			{/* Email Subscribers */}
			<section className="mt-8">
				<h2 className="text-lg font-semibold text-text-pri">Report Subscribers</h2>
				<p className="mt-1 text-sm text-text-muted">
					Manage who receives the intelligence report email
				</p>

				<div className="mt-4 max-w-3xl space-y-4">
					<div className="flex gap-2">
						<input
							type="email"
							placeholder="Email address"
							value={newEmail}
							onChange={(e) => setNewEmail(e.target.value)}
							onKeyDown={(e) => e.key === 'Enter' && addSubscriber()}
							className="flex-1 rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none bg-surface text-text-pri"
						/>
						<input
							type="text"
							placeholder="Name (optional)"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							onKeyDown={(e) => e.key === 'Enter' && addSubscriber()}
							className="w-40 rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none bg-surface text-text-pri"
						/>
						<button
							onClick={addSubscriber}
							className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
						>
							Add
						</button>
					</div>
					{subError && <p className="text-sm text-danger">{subError}</p>}

					{subscribers.length === 0 ? (
						<p className="text-sm text-text-dim">
							No subscribers yet. Add an email to receive report notifications.
						</p>
					) : (
						<div className="rounded-lg border border-border bg-surface divide-y divide-gray-100 dark:divide-neutral-800">
							{subscribers.map((sub) => (
								<div key={sub.id} className="flex items-center justify-between px-4 py-3">
									<div className="flex items-center gap-3 min-w-0">
										<button
											onClick={() => toggleSubscriber(sub.id, !sub.active)}
											role="switch"
											aria-checked={sub.active}
											className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors ${
												sub.active ? 'bg-accent' : 'bg-border'
											}`}
										>
											<span
												className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
													sub.active ? 'translate-x-4' : 'translate-x-0.5'
												} mt-0.5`}
											/>
										</button>
										<div className="min-w-0">
											<p
												className={`text-sm truncate ${sub.active ? 'text-text-pri' : 'text-text-dim line-through'}`}
											>
												{sub.email}
											</p>
											{sub.name && <p className="text-xs text-text-dim">{sub.name}</p>}
										</div>
									</div>
									<button
										onClick={() => removeSubscriber(sub.id)}
										className="flex-shrink-0 text-text-dim hover:text-danger"
									>
										<svg
											className="h-4 w-4"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											strokeWidth={2}
										>
											<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
										</svg>
									</button>
								</div>
							))}
						</div>
					)}
				</div>
			</section>

			{/* Schedules */}
			<section className="mt-8">
				<h2 className="text-lg font-semibold text-text-pri">Schedules</h2>
				<p className="mt-1 text-sm text-text-muted">
					Configure when scrapes and report pipelines run
				</p>
				{scheduleError && <p className="mt-2 text-sm text-danger">{scheduleError}</p>}

				<div className="mt-4 space-y-6 max-w-3xl">
					{/* Scrape Schedules */}
					<div>
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-semibold text-text-pri">Scrape</h3>
							<button
								onClick={() => addSchedule('scrape')}
								className="text-xs font-medium text-accent hover:underline"
							>
								+ Add schedule
							</button>
						</div>
						{scrapeSchedules.length === 0 ? (
							<p className="mt-2 text-sm text-text-dim">No scrape schedules configured.</p>
						) : (
							<div className="mt-2 space-y-2">
								{scrapeSchedules.map((s) => (
									<ScheduleRow
										key={s.id}
										schedule={s}
										onUpdate={updateSchedule}
										onRemove={removeSchedule}
									/>
								))}
							</div>
						)}
					</div>

					{/* Pipeline Schedules */}
					<div>
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-semibold text-text-pri">Report / Content</h3>
							<button
								onClick={() => addSchedule('pipeline')}
								className="text-xs font-medium text-accent hover:underline"
							>
								+ Add schedule
							</button>
						</div>
						{pipelineSchedules.length === 0 ? (
							<p className="mt-2 text-sm text-text-dim">No pipeline schedules configured.</p>
						) : (
							<div className="mt-2 space-y-2">
								{pipelineSchedules.map((s) => (
									<ScheduleRow
										key={s.id}
										schedule={s}
										onUpdate={updateSchedule}
										onRemove={removeSchedule}
									/>
								))}
							</div>
						)}
					</div>

					<p className="text-xs text-text-dim">
						Changes take effect on the next scheduled cycle. Scrape collects data from all sources.
						Pipeline generates the trend report, content drafts, and sends the email notification.
					</p>
				</div>
			</section>

			{/* Source Configuration */}
			<section className="mt-8">
				<h2 className="text-lg font-semibold text-text-pri">Data Sources</h2>
				<p className="mt-1 text-sm text-text-muted">
					Toggle sources on or off for scheduled scrapes
				</p>

				<div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
					<SourceCard
						name="hackernews"
						title="Hacker News"
						items={['Algolia Search API']}
						enabled={!disabledSources.has('hackernews')}
						onToggle={toggleSource}
					/>
					<SourceCard
						name="reddit"
						title="Reddit"
						items={redditSubreddits.map((s) => `r/${s}`)}
						enabled={!disabledSources.has('reddit')}
						onToggle={toggleSource}
					/>
					<SourceCard
						name="github"
						title="GitHub"
						items={githubSearchQueries}
						enabled={!disabledSources.has('github')}
						onToggle={toggleSource}
					/>
					<SourceCard
						name="arxiv"
						title="ArXiv"
						items={arxivCategories}
						enabled={!disabledSources.has('arxiv')}
						onToggle={toggleSource}
					/>
					<SourceCard
						name="hashnode"
						title="Hashnode"
						items={[`Tag: ${hashnodeTag}`]}
						enabled={!disabledSources.has('hashnode')}
						onToggle={toggleSource}
					/>
					<SourceCard
						name="devto"
						title="Dev.to"
						items={['Public REST API']}
						enabled={!disabledSources.has('devto')}
						onToggle={toggleSource}
					/>
					<SourceCard
						name="medium"
						title="Medium"
						items={mediumTags}
						enabled={!disabledSources.has('medium')}
						onToggle={toggleSource}
					/>
					<SourceCard
						name="rss"
						title="RSS / Substack"
						items={[...rssSources.map((s) => s.name), ...substackPublications.map((s) => s.name)]}
						enabled={!disabledSources.has('rss')}
						onToggle={toggleSource}
					/>
				</div>
			</section>
		</div>
	);
}

function ScheduleRow({
	schedule,
	onUpdate,
	onRemove
}: {
	schedule: Schedule;
	onUpdate: (
		id: string,
		updates: Partial<Pick<Schedule, 'hour' | 'minute' | 'days' | 'active'>>
	) => void;
	onRemove: (id: string) => void;
}) {
	const timeValue = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`;

	function handleTimeChange(value: string) {
		const [h, m] = value.split(':').map(Number);
		onUpdate(schedule.id, { hour: h, minute: m });
	}

	function toggleDay(day: number) {
		const next = schedule.days.includes(day)
			? schedule.days.filter((d) => d !== day)
			: [...schedule.days, day].sort();
		if (next.length === 0) return;
		onUpdate(schedule.id, { days: next });
	}

	return (
		<div
			className={`flex items-center gap-3 rounded-lg border p-3 ${
				schedule.active ? 'border-border bg-surface' : 'border-border bg-bg opacity-60'
			}`}
		>
			<button
				onClick={() => onUpdate(schedule.id, { active: !schedule.active })}
				role="switch"
				aria-checked={schedule.active}
				className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors ${
					schedule.active ? 'bg-accent' : 'bg-border'
				}`}
			>
				<span
					className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
						schedule.active ? 'translate-x-4' : 'translate-x-0.5'
					} mt-0.5`}
				/>
			</button>

			<input
				type="time"
				value={timeValue}
				onChange={(e) => handleTimeChange(e.target.value)}
				className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-pri focus:border-accent focus:outline-none"
			/>

			<div className="flex gap-1">
				{DAY_LABELS.map((label, i) => (
					<button
						key={i}
						onClick={() => toggleDay(i)}
						className={`h-7 w-7 rounded text-xs font-medium transition ${
							schedule.days.includes(i)
								? 'bg-accent text-accent-text'
								: 'bg-bg-alt text-text-dim hover:bg-gray-200 dark:hover:bg-neutral-700'
						}`}
					>
						{label.charAt(0)}
					</button>
				))}
			</div>

			<button
				onClick={() => onRemove(schedule.id)}
				className="ml-auto flex-shrink-0 text-text-dim hover:text-danger"
			>
				<svg
					className="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={2}
				>
					<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>
	);
}

function SourceCard({
	name,
	title,
	items,
	enabled,
	onToggle
}: {
	name: string;
	title: string;
	items: string[];
	enabled: boolean;
	onToggle: (name: string) => void;
}) {
	return (
		<div
			className={`rounded-lg border p-4 transition ${enabled ? 'border-border bg-surface' : 'border-border bg-bg opacity-60'}`}
		>
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold text-text-pri">{title}</h3>
				<button
					onClick={() => onToggle(name)}
					role="switch"
					aria-checked={enabled}
					className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors ${
						enabled ? 'bg-accent' : 'bg-border'
					}`}
				>
					<span
						className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
							enabled ? 'translate-x-4' : 'translate-x-0.5'
						} mt-0.5`}
					/>
				</button>
			</div>
			<div className="mt-2 flex flex-wrap gap-1.5">
				{items.map((item) => (
					<span key={item} className="rounded bg-bg-alt px-2 py-0.5 text-xs text-text-sec">
						{item}
					</span>
				))}
			</div>
		</div>
	);
}
