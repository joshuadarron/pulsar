export {
	ALL_CONTENT_PLATFORMS,
	type AngleChoice,
	buildAnglePickerSystemPrompt,
	buildAnglePickerUserPrompt,
	buildDrafterSystemPrompt,
	buildDrafterUserPrompt,
	type ContentPlatform,
	PLATFORM_FORMAT_SPECS,
	voiceFormatForPlatform
} from './content-drafts.js';
export {
	buildDrafterV2SystemPrompt,
	buildDrafterV2UserPrompt,
	buildRecommendationSystemPrompt,
	buildRecommendationUserPrompt,
	FORMAT_TO_PLATFORMS,
	voiceFormatsForContentFormat
} from './content-recommendations.js';
export {
	buildSectionPrompts,
	buildSupportingResourcesPrompt,
	buildSystemPrompt
} from './trend-report.js';
