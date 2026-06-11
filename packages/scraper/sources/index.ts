import { arxiv } from './arxiv';
import { devto } from './devto';
import { github } from './github';
import { hackernews } from './hackernews';
import { hashnode } from './hashnode';
import { medium } from './medium';
import { reddit } from './reddit';
import { rss } from './rss';
import type { SourceAdapter } from './types';

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
