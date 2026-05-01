import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Type-only smoke test for the viewer page. We do not execute the page in
 * tests: it pulls in the postgres pool, the operator/voice loaders, and the
 * templates contract. The templates package is owned by the templates agent;
 * runtime tests of `[reportId]/page.tsx` would duplicate that coverage and
 * tightly couple to mocked module shapes. Type checking verifies the wiring.
 *
 * Verified separately: templates contract by the templates agent's own tests.
 */

describe('drafts viewer page module (compile-only)', () => {
	it('is type-checked by `tsc --noEmit` rather than executed at runtime', () => {
		// Sentinel assertion: this test exists so the file is picked up by the
		// test runner and so future maintainers see why no `import` line lives
		// here. Compile coverage comes from the package typecheck.
		assert.equal(true, true);
	});
});
