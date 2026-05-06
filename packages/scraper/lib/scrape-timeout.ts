// Fail-safe wrapper around a scrape invocation. A healthy full scrape finishes
// in 2-3 minutes; we cap at 30 by default. Without this, a wedged source
// adapter (Reddit hung mid-response in the past) leaves the scheduler's
// `scrapeRunning` flag stuck true and silently kills every future tick.
export class ScrapeTimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super(`Scrape exceeded ${timeoutMs}ms fail-safe timeout`);
		this.name = 'ScrapeTimeoutError';
		this.timeoutMs = timeoutMs;
	}
}

export function withScrapeTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new ScrapeTimeoutError(timeoutMs)), timeoutMs);
	});
	return Promise.race([fn(), timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	}) as Promise<T>;
}
