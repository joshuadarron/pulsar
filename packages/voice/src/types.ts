export type VoiceFormat = 'long-form' | 'linkedin' | 'reddit' | 'discord' | 'twitter' | 'other';

export const ALL_VOICE_FORMATS: readonly VoiceFormat[] = [
	'long-form',
	'linkedin',
	'reddit',
	'discord',
	'twitter',
	'other'
] as const;

export type VoiceProfile = {
	tone: string;
	sentencePatterns: string;
	neverWrite: string;
	formats: VoiceFormat[];
};

export type VoiceContext = {
	profile: VoiceProfile;
	samples: Record<VoiceFormat, string[]>;
};

export class VoiceContextNotConfiguredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VoiceContextNotConfiguredError';
	}
}
