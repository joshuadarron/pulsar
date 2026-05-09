'use client';

import type React from 'react';
import { useEffect, useState } from 'react';

import ViewerTabs, { type PlatformTabContent } from './ViewerTabs';

export interface RecommendationTab {
	key: string;
	label: string;
	tooltip?: string;
	headerNode: React.ReactNode;
	platforms: PlatformTabContent[];
}

interface RecommendationsTabsProps {
	recommendations: RecommendationTab[];
}

/**
 * Two-level tab viewer for content drafts. The outer tab list selects an
 * angle (or recommendation in the V2 shape), and the active panel renders
 * that angle's header followed by the per-platform `ViewerTabs` (which in
 * turn nests content/steps/voice/topic sub-tabs under each platform).
 *
 * If there's only one recommendation we drop the outer tab strip entirely
 * since a single tab is just chrome.
 */
export default function RecommendationsTabs({ recommendations }: RecommendationsTabsProps) {
	const [activeKey, setActiveKey] = useState<string>(recommendations[0]?.key ?? '');

	// Reset the active tab when the underlying list changes (e.g. a new report
	// is fetched on this route). Without this, a stale key would render the
	// first panel as a fallback and the user would see a tab marked active that
	// no longer exists.
	useEffect(() => {
		if (!recommendations.find((r) => r.key === activeKey)) {
			setActiveKey(recommendations[0]?.key ?? '');
		}
	}, [recommendations, activeKey]);

	if (recommendations.length === 0) {
		return null;
	}

	const active = recommendations.find((r) => r.key === activeKey) ?? recommendations[0];

	if (recommendations.length === 1) {
		return (
			<section className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-950 p-5">
				{active.headerNode}
				<ViewerTabs platforms={active.platforms} />
			</section>
		);
	}

	return (
		<div>
			<div className="border-b border-gray-200 dark:border-neutral-700">
				<nav role="tablist" aria-label="Angles" className="-mb-px flex space-x-8 overflow-x-auto">
					{recommendations.map((rec) => {
						const isActive = rec.key === active.key;
						return (
							<button
								key={rec.key}
								role="tab"
								type="button"
								aria-selected={isActive}
								aria-controls={`recommendation-panel-${rec.key}`}
								id={`recommendation-tab-${rec.key}`}
								onClick={() => setActiveKey(rec.key)}
								title={rec.tooltip ?? rec.label}
								className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium ${
									isActive
										? 'border-indigo-500 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
										: 'border-transparent text-gray-500 dark:text-neutral-400 hover:border-gray-300 hover:text-gray-700 dark:hover:border-neutral-600 dark:hover:text-neutral-200'
								}`}
							>
								{rec.label}
							</button>
						);
					})}
				</nav>
			</div>

			<section
				role="tabpanel"
				id={`recommendation-panel-${active.key}`}
				aria-labelledby={`recommendation-tab-${active.key}`}
				className="mt-6 rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-950 p-5"
			>
				{active.headerNode}
				<ViewerTabs platforms={active.platforms} />
			</section>
		</div>
	);
}
