export type RubricScale = '1-5' | 'binary';

export interface RubricDimension {
	dimension: string;
	scale: RubricScale;
	description: string;
}

export const TREND_REPORT_RUBRIC: RubricDimension[] = [
	{
		dimension: 'grounding',
		scale: '1-5',
		description: 'Claims tied to specific entities, articles, data points from the input payload.'
	},
	{
		dimension: 'specificity',
		scale: '1-5',
		description: 'Names named things instead of hedging with generalities.'
	},
	{
		dimension: 'tone_match',
		scale: '1-5',
		description: 'Technical, builder-oriented, no marketing-speak or hype words.'
	},
	{
		dimension: 'actionability',
		scale: '1-5',
		description: 'contentRecommendations give specific, plausible ideas tied to specific trends.'
	},
	{
		dimension: 'internal_consistency',
		scale: '1-5',
		description: 'Sections agree with each other, no contradictions across passes.'
	}
];

export const CONTENT_DRAFT_RUBRIC: RubricDimension[] = [
	{
		dimension: 'tone_match',
		scale: '1-5',
		description: 'Matches the platform voice and the project no-marketing-speak rule.'
	},
	{
		dimension: 'technical_accuracy',
		scale: '1-5',
		description: 'Claims about RocketRide are correct per rocketrideContext fields.'
	},
	{
		dimension: 'grounding',
		scale: '1-5',
		description: 'Tied to a specific trend or insight from the report.'
	}
];
