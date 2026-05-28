'use client';

import type React from 'react';
import { useEffect, useState } from 'react';

export interface ArticleFileSet {
	id: string;
	articleSlug: string;
	title: string | null;
	subtitle: string | null;
	angle: string;
	opportunitySignal: string;
	metaphorFamily: string | null;
	primaryMediumPub: string | null;
	contentMd: string;
	quotesMd: string;
	imagesMd: string;
	publicationsMd: string;
	contentHtml: string;
	quotesHtml: string;
	imagesHtml: string;
	publicationsHtml: string;
}

type FileTab = 'content' | 'quotes' | 'images' | 'publications';

const FILE_TABS: ReadonlyArray<{ key: FileTab; label: string }> = [
	{ key: 'content', label: 'Content' },
	{ key: 'quotes', label: 'Quotes' },
	{ key: 'images', label: 'Images' },
	{ key: 'publications', label: 'Publications' }
];

const ONES = [
	'',
	'One',
	'Two',
	'Three',
	'Four',
	'Five',
	'Six',
	'Seven',
	'Eight',
	'Nine',
	'Ten',
	'Eleven',
	'Twelve',
	'Thirteen',
	'Fourteen',
	'Fifteen',
	'Sixteen',
	'Seventeen',
	'Eighteen',
	'Nineteen'
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/**
 * Spell a small positive integer as a Title-Cased English word ("One",
 * "Twenty One"). Tab labels use this so a long article title cannot blow
 * the tab strip out horizontally; the full title still shows in the tab
 * tooltip and again in the panel header below. Mirrors the same helper in
 * the drafts viewer.
 */
function numberWord(n: number): string {
	if (!Number.isInteger(n) || n < 1 || n > 99) return String(n);
	if (n < 20) return ONES[n];
	const tens = Math.floor(n / 10);
	const ones = n % 10;
	if (ones === 0) return TENS[tens];
	return `${TENS[tens]} ${ONES[ones]}`;
}

function CopyButton({ text, label = 'Copy markdown' }: { text: string; label?: string }) {
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

function ArticleHeader({ article }: { article: ArticleFileSet }) {
	const fields: { key: string; label: string; body: React.ReactNode }[] = [];
	fields.push({ key: 'signal', label: 'Signal', body: article.opportunitySignal });
	fields.push({ key: 'angle', label: 'Angle', body: article.angle });
	if (article.metaphorFamily) {
		fields.push({
			key: 'metaphor',
			label: 'Metaphor',
			body: <code className="font-mono text-[12px]">{article.metaphorFamily}</code>
		});
	}
	if (article.primaryMediumPub) {
		fields.push({
			key: 'medium',
			label: 'Primary Medium',
			body: article.primaryMediumPub
		});
	}
	fields.push({
		key: 'slug',
		label: 'Slug',
		body: <code className="font-mono text-[12px]">{article.articleSlug}</code>
	});

	return (
		<header className="mb-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-100">
						{article.title ?? article.articleSlug}
					</h2>
					{article.subtitle ? (
						<p className="mt-1 italic text-sm text-gray-600 dark:text-neutral-400">
							{article.subtitle}
						</p>
					) : null}
				</div>
			</div>
			<dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
				{fields.map((field) => (
					<div key={field.key} className="contents">
						<dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400">
							{field.label}
						</dt>
						<dd className="text-sm text-gray-800 dark:text-neutral-200 break-words">
							{field.body}
						</dd>
					</div>
				))}
			</dl>
		</header>
	);
}

function FileTabs({ article }: { article: ArticleFileSet }) {
	const [activeTab, setActiveTab] = useState<FileTab>('content');

	const htmlByTab: Record<FileTab, string> = {
		content: article.contentHtml,
		quotes: article.quotesHtml,
		images: article.imagesHtml,
		publications: article.publicationsHtml
	};
	const markdownByTab: Record<FileTab, string> = {
		content: article.contentMd,
		quotes: article.quotesMd,
		images: article.imagesMd,
		publications: article.publicationsMd
	};

	return (
		<div>
			<div className="flex flex-wrap items-center gap-2">
				{FILE_TABS.map((tab) => (
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
				<div className="ml-auto">
					<CopyButton text={markdownByTab[activeTab]} />
				</div>
			</div>

			<div className="mt-4 rounded-md border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
				<div
					className="text-sm text-gray-800 dark:text-neutral-200"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: HTML produced server-side by trusted markdown helper that escapes user input
					dangerouslySetInnerHTML={{ __html: htmlByTab[activeTab] }}
				/>
			</div>
		</div>
	);
}

interface ArticleViewerProps {
	articles: ArticleFileSet[];
}

export default function ArticleViewer({ articles }: ArticleViewerProps) {
	const [activeKey, setActiveKey] = useState<string>(articles[0]?.id ?? '');

	useEffect(() => {
		if (!articles.find((a) => a.id === activeKey)) {
			setActiveKey(articles[0]?.id ?? '');
		}
	}, [articles, activeKey]);

	if (articles.length === 0) {
		return (
			<section className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-950 p-5">
				<p className="text-sm text-gray-700 dark:text-neutral-300">
					No articles persisted for this report. The picker may have judged that no interpretations
					met the bar.
				</p>
			</section>
		);
	}

	const active = articles.find((a) => a.id === activeKey) ?? articles[0];

	if (articles.length === 1) {
		return (
			<section className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-950 p-5">
				<ArticleHeader article={active} />
				<FileTabs article={active} />
			</section>
		);
	}

	return (
		<div>
			<div className="border-b border-gray-200 dark:border-neutral-700">
				<nav role="tablist" aria-label="Articles" className="-mb-px flex space-x-8 overflow-x-auto">
					{articles.map((entry, idx) => {
						const isActive = entry.id === active.id;
						const tooltip = entry.title ?? entry.articleSlug;
						return (
							<button
								key={entry.id}
								role="tab"
								type="button"
								aria-selected={isActive}
								aria-controls={`article-panel-${entry.id}`}
								id={`article-tab-${entry.id}`}
								onClick={() => setActiveKey(entry.id)}
								title={tooltip}
								className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium ${
									isActive
										? 'border-indigo-500 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
										: 'border-transparent text-gray-500 dark:text-neutral-400 hover:border-gray-300 hover:text-gray-700 dark:hover:border-neutral-600 dark:hover:text-neutral-200'
								}`}
							>
								{numberWord(idx + 1)}
							</button>
						);
					})}
				</nav>
			</div>

			<section
				role="tabpanel"
				id={`article-panel-${active.id}`}
				aria-labelledby={`article-tab-${active.id}`}
				className="mt-6 rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-950 p-5"
			>
				<ArticleHeader article={active} />
				<FileTabs article={active} />
			</section>
		</div>
	);
}
