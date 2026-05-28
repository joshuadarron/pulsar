'use client';

import React, { useState } from 'react';

export interface ArticleFileSet {
	id: string;
	articleSlug: string;
	title: string | null;
	subtitle: string | null;
	angle: string;
	opportunitySignal: string;
	metaphorFamily: string | null;
	primaryMediumPub: string | null;
	contentHtml: string;
	quotesHtml: string;
	imagesHtml: string;
	publicationsHtml: string;
}

type FileTab = 'content' | 'quotes' | 'images' | 'publications';

const FILE_TABS: ReadonlyArray<{ id: FileTab; label: string }> = [
	{ id: 'content', label: 'Content' },
	{ id: 'quotes', label: 'Quotes' },
	{ id: 'images', label: 'Images' },
	{ id: 'publications', label: 'Publications' }
];

export default function ArticleViewer({ articles }: { articles: ArticleFileSet[] }) {
	const [activeArticleIdx, setActiveArticleIdx] = useState(0);
	const [activeFile, setActiveFile] = useState<FileTab>('content');

	if (articles.length === 0) {
		return (
			<div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6">
				<p className="text-sm text-gray-700 dark:text-neutral-300">
					No articles persisted for this report.
				</p>
			</div>
		);
	}

	const article = articles[activeArticleIdx] ?? articles[0];
	const htmlForFile: Record<FileTab, string> = {
		content: article.contentHtml,
		quotes: article.quotesHtml,
		images: article.imagesHtml,
		publications: article.publicationsHtml
	};

	return (
		<div>
			<div className="border-b border-gray-200 dark:border-neutral-800">
				<div className="flex flex-wrap gap-1">
					{articles.map((entry, idx) => (
						<button
							key={entry.id}
							type="button"
							onClick={() => {
								setActiveArticleIdx(idx);
								setActiveFile('content');
							}}
							className={`rounded-t-md px-4 py-2 text-sm font-medium transition ${
								idx === activeArticleIdx
									? 'border-b-2 border-indigo-600 text-indigo-700 dark:text-indigo-300'
									: 'text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-200'
							}`}
						>
							<span className="block max-w-[18rem] truncate">
								{entry.title ?? entry.articleSlug}
							</span>
						</button>
					))}
				</div>
			</div>

			<div className="mt-4 rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
				<div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
					<div className="min-w-0 flex-1">
						<h2 className="text-xl font-semibold text-gray-900 dark:text-neutral-100">
							{article.title ?? article.articleSlug}
						</h2>
						{article.subtitle ? (
							<p className="mt-1 italic text-gray-600 dark:text-neutral-400">{article.subtitle}</p>
						) : null}
					</div>
					<div className="text-xs text-gray-500 dark:text-neutral-400">
						<p>
							<span className="font-medium">Angle:</span> {article.angle}
						</p>
						<p className="mt-0.5">
							<span className="font-medium">Signal:</span> {article.opportunitySignal}
						</p>
						{article.metaphorFamily ? (
							<p className="mt-0.5">
								<span className="font-medium">Metaphor:</span> {article.metaphorFamily}
							</p>
						) : null}
						{article.primaryMediumPub ? (
							<p className="mt-0.5">
								<span className="font-medium">Primary Medium:</span> {article.primaryMediumPub}
							</p>
						) : null}
					</div>
				</div>

				<div className="border-b border-gray-200 dark:border-neutral-800">
					<div className="flex gap-1">
						{FILE_TABS.map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => setActiveFile(tab.id)}
								className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition ${
									tab.id === activeFile
										? 'border-b-2 border-indigo-600 text-indigo-700 dark:text-indigo-300'
										: 'text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-200'
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>
				</div>

				<div
					className="prose prose-sm dark:prose-invert mt-4 max-w-none text-gray-900 dark:text-neutral-100"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: HTML produced server-side by trusted markdown helper that escapes user input
					dangerouslySetInnerHTML={{ __html: htmlForFile[activeFile] }}
				/>
			</div>
		</div>
	);
}
