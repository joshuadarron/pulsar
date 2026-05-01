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
			className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
		>
			{copied ? 'Copied' : label}
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

			<div className="mt-4 flex flex-wrap gap-2">
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
					<div className="space-y-3">
						<CopyButton text={current.voicePromptText} />
						<pre className="whitespace-pre-wrap rounded-md border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-950 p-4 text-xs font-mono text-gray-800 dark:text-neutral-200">
							{current.voicePromptText}
						</pre>
					</div>
				) : null}

				{activeTab === 'topic' ? (
					<div className="space-y-3">
						<CopyButton text={current.topicPromptText} />
						<pre className="whitespace-pre-wrap rounded-md border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-950 p-4 text-xs font-mono text-gray-800 dark:text-neutral-200">
							{current.topicPromptText}
						</pre>
					</div>
				) : null}
			</div>
		</div>
	);
}

export type { PlatformTabContent, ViewerTabsProps };
