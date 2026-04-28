import type { ValidationCheck } from '@pulsar/shared/types';

export interface SubCheckRun {
	checks: ValidationCheck[];
}

const EM_DASH_RE = /—/;
const JSON_FENCE_RE = /```json/i;
const CODE_FENCE_RE = /```/;

function wordCount(body: string): number {
	return body.trim().split(/\s+/).filter(Boolean).length;
}

function hasMarkdownHeader(body: string): boolean {
	return /^#{1,6}\s/m.test(body);
}

function endsWithQuestion(body: string): boolean {
	return body.trimEnd().endsWith('?');
}

function sentenceCount(body: string): number {
	return body
		.trim()
		.split(/[.!?]+\s+/)
		.filter((s) => s.trim().length > 0).length;
}

function commonChecks(body: string): ValidationCheck[] {
	return [
		{
			check_name: 'no_em_dashes',
			passed: !EM_DASH_RE.test(body),
			detail: EM_DASH_RE.test(body) ? 'em-dash found' : undefined
		},
		{
			check_name: 'no_json_fence_leakage',
			passed: !JSON_FENCE_RE.test(body),
			detail: JSON_FENCE_RE.test(body) ? '```json fence leaked into draft' : undefined
		}
	];
}

function articleChecks(body: string, minWords: number, maxWords: number): ValidationCheck[] {
	const wc = wordCount(body);
	const wcOk = wc >= minWords && wc <= maxWords;
	return [
		{
			check_name: 'word_count_in_range',
			passed: wcOk,
			detail: wcOk ? `${wc} words` : `${wc} words, expected ${minWords}-${maxWords}`
		},
		{
			check_name: 'has_code_fence',
			passed: CODE_FENCE_RE.test(body),
			detail: CODE_FENCE_RE.test(body) ? undefined : 'no code fence found'
		}
	];
}

function hashnodeChecks(body: string): ValidationCheck[] {
	return [...articleChecks(body, 1500, 2500), ...commonChecks(body)];
}
const mediumChecks = hashnodeChecks;
const devtoChecks = hashnodeChecks;

function hackernewsChecks(body: string): ValidationCheck[] {
	const firstLine = body.split('\n')[0] ?? '';
	const startsRight = /^(Show HN:|Ask HN:)/.test(firstLine);
	return [
		{
			check_name: 'first_line_under_80_chars',
			passed: firstLine.length < 80,
			detail:
				firstLine.length < 80
					? `${firstLine.length} chars`
					: `${firstLine.length} chars, expected < 80`
		},
		{
			check_name: 'starts_with_show_or_ask_hn',
			passed: startsRight,
			detail: startsRight ? undefined : 'first line does not start with Show HN: or Ask HN:'
		},
		...commonChecks(body)
	];
}

function linkedinChecks(body: string): ValidationCheck[] {
	const wc = wordCount(body);
	const wcOk = wc >= 800 && wc <= 1200;
	return [
		{
			check_name: 'word_count_in_range',
			passed: wcOk,
			detail: wcOk ? `${wc} words` : `${wc} words, expected 800-1200`
		},
		{
			check_name: 'no_markdown_headers',
			passed: !hasMarkdownHeader(body),
			detail: hasMarkdownHeader(body) ? 'markdown header found (#, ##)' : undefined
		},
		{
			check_name: 'ends_with_question',
			passed: endsWithQuestion(body),
			detail: endsWithQuestion(body) ? undefined : 'does not end with ?'
		},
		...commonChecks(body)
	];
}

function twitterChecks(body: string): ValidationCheck[] {
	const lines = body.split('\n').filter((l) => l.trim().length > 0);
	const numbered = lines.filter((l) => /^\d+\//.test(l.trim()));
	const tweets = numbered.length > 0 ? numbered : lines;
	const overLimit = tweets.find((t) => t.length > 280);
	const lastTweet = tweets[tweets.length - 1] ?? '';
	const mentionsRocketRide = /rocketride/i.test(lastTweet);
	return [
		{
			check_name: 'has_numbered_thread',
			passed: numbered.length >= 2,
			detail:
				numbered.length >= 2
					? `${numbered.length} numbered tweets`
					: 'no numbered thread (lines starting 2/, 3/, etc.) found'
		},
		{
			check_name: 'each_tweet_under_280',
			passed: !overLimit,
			detail: overLimit ? `tweet over 280 chars: ${overLimit.slice(0, 60)}...` : undefined
		},
		{
			check_name: 'last_tweet_mentions_rocketride',
			passed: mentionsRocketRide,
			detail: mentionsRocketRide ? undefined : 'last tweet does not mention rocketride'
		},
		...commonChecks(body)
	];
}

function discordChecks(body: string): ValidationCheck[] {
	const sc = sentenceCount(body);
	const scOk = sc >= 2 && sc <= 3;
	return [
		{
			check_name: 'sentence_count_2_to_3',
			passed: scOk,
			detail: scOk ? `${sc} sentences` : `${sc} sentences, expected 2-3`
		},
		{
			check_name: 'ends_with_question',
			passed: endsWithQuestion(body),
			detail: endsWithQuestion(body) ? undefined : 'does not end with ?'
		},
		...commonChecks(body)
	];
}

const PLATFORM_CHECKS: Record<string, (body: string) => ValidationCheck[]> = {
	hashnode: hashnodeChecks,
	medium: mediumChecks,
	devto: devtoChecks,
	hackernews: hackernewsChecks,
	linkedin: linkedinChecks,
	twitter: twitterChecks,
	discord: discordChecks
};

export function runSubChecks(platform: string, body: string): SubCheckRun {
	const fn = PLATFORM_CHECKS[platform];
	if (!fn) return { checks: [] };
	return { checks: fn(body) };
}
