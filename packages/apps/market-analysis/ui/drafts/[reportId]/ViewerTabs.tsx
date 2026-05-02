'use client';

import type React from 'react';
import { useState } from 'react';

export type TabKey = 'content' | 'steps' | 'voice' | 'topic';

const TAB_ORDER: { key: TabKey; label: string }[] = [
	{ key: 'content', label: 'Generated content' },
	{ key: 'steps', label: 'Steps to post' },
	{ key: 'voice', label: 'Voice transfer prompt' },
	{ key: 'topic', label: 'Topic refinement prompt' }
];

interface PlatformTabContent {
	platform: string;
	contentNode: React.ReactNode;
	stepsHtml: string;
	voicePromptText: string;
	topicPromptText: string;
}

interface ViewerTabsProps {
	platforms: PlatformTabContent[];
}

function CopyButton({ text, label = 'Copy to clipboard' }: { text: string; label?: string }) {
	const [copied, setCopied] = useState(false);

	function handleCopy() {
		if (typeof navigator === 'undefined' || !navigator.clipboard) return;
		navigator.clipboard.writeText(text).then(
			() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			},
			() => {
				setCopied(false);
			}
		);
	}

	return (
		<button
			type="button"
			onClick={handleCopy}
			disabled={!text}
			className="rounded-md border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-1.5 text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
			title={copied ? 'Copied' : label}
			aria-label={copied ? 'Copied' : label}
		>
			{copied ? (
				<svg
					className="h-4 w-4 text-green-600 dark:text-green-400"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={2}
					aria-hidden="true"
				>
					<path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
				</svg>
			) : (
				<svg
					className="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={1.5}
					aria-hidden="true"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
					/>
				</svg>
			)}
		</button>
	);
}

export default function ViewerTabs({ platforms }: ViewerTabsProps) {
	const [activePlatform, setActivePlatform] = useState(platforms[0]?.platform ?? '');
	const [activeTab, setActiveTab] = useState<TabKey>('content');

	if (platforms.length === 0) {
		return <p className="text-sm text-gray-500 dark:text-neutral-400">No drafts for this angle.</p>;
	}

	const current = platforms.find((p) => p.platform === activePlatform) ?? platforms[0];

	return (
		<div>
			<div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-neutral-700 pb-3">
				{platforms.map((p) => (
					<button
						key={p.platform}
						type="button"
						onClick={() => setActivePlatform(p.platform)}
						className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
							activePlatform === p.platform
								? 'bg-indigo-600 text-white'
								: 'bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-neutral-400 hover:bg-gray-200 dark:hover:bg-neutral-700'
						}`}
					>
						{p.platform}
					</button>
				))}
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-2">
				{TAB_ORDER.map((tab) => (
					<button
						key={tab.key}
						type="button"
						onClick={() => setActiveTab(tab.key)}
						className={`rounded-md px-3 py-1.5 text-xs font-medium ${
							activeTab === tab.key
								? 'bg-gray-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
								: 'bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-700'
						}`}
					>
						{tab.label}
					</button>
				))}
				{(activeTab === 'voice' || activeTab === 'topic') && (
					<div className="ml-auto">
						<CopyButton
							text={activeTab === 'voice' ? current.voicePromptText : current.topicPromptText}
						/>
					</div>
				)}
			</div>

			<div className="mt-4">
				{activeTab === 'content' ? (
					<div className="rounded-md border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
						{current.contentNode}
					</div>
				) : null}

				{activeTab === 'steps' ? (
					<div className="rounded-md border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
						<div
							className="prose-steps text-sm text-gray-800 dark:text-neutral-200"
							// biome-ignore lint/security/noDangerouslySetInnerHtml: HTML produced server-side by trusted markdown helper that escapes user input
							dangerouslySetInnerHTML={{ __html: current.stepsHtml }}
						/>
					</div>
				) : null}

				{activeTab === 'voice' ? (
					<pre className="whitespace-pre-wrap rounded-md border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-950 p-4 text-xs font-mono text-gray-800 dark:text-neutral-200">
						{current.voicePromptText}
					</pre>
				) : null}

				{activeTab === 'topic' ? (
					<pre className="whitespace-pre-wrap rounded-md border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-950 p-4 text-xs font-mono text-gray-800 dark:text-neutral-200">
						{current.topicPromptText}
					</pre>
				) : null}
			</div>
		</div>
	);
}

export type { PlatformTabContent, ViewerTabsProps };
