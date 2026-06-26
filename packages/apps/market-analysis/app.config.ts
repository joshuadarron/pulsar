import type { AppConfig } from '@pulsar/shared/types';

export const appConfig: AppConfig = {
	name: 'market-analysis',
	description:
		'Tracks AI ecosystem signals across developer sources, generates trend reports and content drafts.',
	schedule: {
		trendReport: { hour: 5, minute: 30 },
		contentDrafts: 'after-trend-report'
	},
	outputType: 'report',
	renderMode: 'technical',
	expectedContext: [
		'operatorName',
		'orgName',
		'positioning',
		'audience',
		'hardRules',
		'groundingUrls',
		'trackedEntities'
	],
	expectedVoiceFormats: ['long-form', 'linkedin', 'reddit', 'discord', 'twitter'],
	views: [
		{
			id: 'market-analysis.report',
			title: 'Market Analysis Report',
			route: '/reports/:id',
			parameterized: true
		},
		{
			id: 'market-analysis.drafts.list',
			title: 'Content Drafts',
			route: '/drafts'
		},
		{
			id: 'market-analysis.articles.list',
			title: 'Articles',
			route: '/articles'
		},
		{
			id: 'market-analysis.articles.viewer',
			title: 'Articles for report',
			route: '/articles/:reportId',
			parameterized: true
		}
	],
	endpoints: [
		{
			id: 'report.get',
			description: 'Fetch a single report as a renderable view-model.',
			path: '/api/v1/views/market-analysis.report/:id'
		},
		{
			id: 'drafts.list',
			description: 'List draft groups across recent reports.',
			path: '/api/v1/views/market-analysis.drafts.list'
		},
		{
			id: 'articles.list',
			description: 'List article packages grouped by report.',
			path: '/api/v1/views/market-analysis.articles.list'
		},
		{
			id: 'articles.viewer',
			description: 'Fetch the four-file article set for one report.',
			path: '/api/v1/views/market-analysis.articles.viewer/:reportId'
		}
	]
};
