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
	expectedVoiceFormats: ['long-form', 'linkedin', 'reddit', 'discord', 'twitter']
};
