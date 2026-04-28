export async function withRetry<T>(
	fn: () => Promise<T>,
	maxAttempts = 3,
	delayMs = 1000
): Promise<T> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (attempt < maxAttempts) {
				const delay = delayMs * 2 ** (attempt - 1);
				console.warn(`Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`);
				await new Promise((r) => setTimeout(r, delay));
			}
		}
	}

	throw lastError;
}
