import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { listRegisteredViews, resolveView } from '../index.js';

describe('viewRegistry', () => {
	it('lists every view declared in app.config.ts', () => {
		const ids = listRegisteredViews();
		assert.ok(ids.includes('market-analysis.report'));
		assert.ok(ids.includes('market-analysis.drafts.list'));
		assert.ok(ids.includes('market-analysis.articles.list'));
		assert.ok(ids.includes('market-analysis.articles.viewer'));
	});

	it('returns 404 for an unknown view id', async () => {
		const result = await resolveView('nonexistent.view');
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.status, 404);
	});

	it('returns 400 when a parameterized view is called without a param', async () => {
		const result = await resolveView('market-analysis.report');
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.status, 400);
	});
});
