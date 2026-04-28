import type { SourceAdapter } from './types';
import { hackernews } from './hackernews';
import { reddit } from './reddit';
import { github } from './github';
import { arxiv } from './arxiv';
import { hashnode } from './hashnode';
import { devto } from './devto';
import { medium } from './medium';
import { rss } from './rss';

export const sources: Record<string, SourceAdapter> = {
	hackernews,
	reddit,
	github,
	arxiv,
	hashnode,
	devto,
	medium,
	rss
};
