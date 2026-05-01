import type { ReportData, ValidationCheck } from '@pulsar/shared/types';

export type ValidatorResult = { passed: boolean; detail?: string };

export type Validator = {
	name: string;
	description: string;
	check: (output: unknown) => ValidatorResult;
};

export type ValidatorSuite = {
	pipelineName: string;
	validators: Validator[];
};

export type ValidationRun = {
	passed: boolean;
	checks: ValidationCheck[];
	error_summary: string | null;
};

export function runValidators(suite: ValidatorSuite, output: unknown): ValidationRun {
	const checks: ValidationCheck[] = suite.validators.map((v) => {
		try {
			const r = v.check(output);
			return { check_name: v.name, passed: r.passed, detail: r.detail };
		} catch (err) {
			return {
				check_name: v.name,
				passed: false,
				detail: `validator threw: ${err instanceof Error ? err.message : String(err)}`
			};
		}
	});
	const failed = checks.filter((c) => !c.passed);
	return {
		passed: failed.length === 0,
		checks,
		error_summary:
			failed.length === 0
				? null
				: failed.map((c) => `${c.check_name}: ${c.detail ?? 'failed'}`).join('; ')
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): boolean {
	return typeof value === 'string' && value.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Suite: rocketride-context.pipe
// Output shape: { packages: { pypi, npm, vscode, openvsx }, sites: { ... }, fetched_at }
// ---------------------------------------------------------------------------

export const ROCKETRIDE_CONTEXT_SUITE: ValidatorSuite = {
	pipelineName: 'rocketride-context.pipe',
	validators: [
		{
			name: 'has_packages',
			description: 'packages.{pypi,npm,vscode,openvsx} keys exist',
			check: (out) => {
				if (!isObject(out)) return { passed: false, detail: 'output not an object' };
				const pkgs = out.packages;
				if (!isObject(pkgs)) return { passed: false, detail: 'packages missing or not object' };
				const required = ['pypi', 'npm', 'vscode', 'openvsx'];
				const missing = required.filter((k) => !(k in pkgs));
				return missing.length === 0
					? { passed: true }
					: { passed: false, detail: `missing keys: ${missing.join(', ')}` };
			}
		},
		{
			name: 'has_sites',
			description: 'sites.{marketing,docs_index,github_readme,founder_article} keys exist',
			check: (out) => {
				if (!isObject(out)) return { passed: false, detail: 'output not an object' };
				const sites = out.sites;
				if (!isObject(sites)) return { passed: false, detail: 'sites missing or not object' };
				const required = ['marketing', 'docs_index', 'github_readme', 'founder_article'];
				const missing = required.filter((k) => !(k in sites));
				return missing.length === 0
					? { passed: true }
					: { passed: false, detail: `missing keys: ${missing.join(', ')}` };
			}
		},
		{
			name: 'has_fetched_at',
			description: 'fetched_at ISO 8601 timestamp present',
			check: (out) => {
				if (!isObject(out)) return { passed: false, detail: 'output not an object' };
				const ts = out.fetched_at;
				if (typeof ts !== 'string') return { passed: false, detail: 'fetched_at not a string' };
				const parsed = Date.parse(ts);
				return Number.isFinite(parsed)
					? { passed: true }
					: { passed: false, detail: `not a valid ISO timestamp: ${ts}` };
			}
		},
		{
			name: 'at_least_one_package_non_null',
			description: 'catches total HTTP failure',
			check: (out) => {
				if (!isObject(out) || !isObject(out.packages))
					return { passed: false, detail: 'packages object missing' };
				const anyPresent = Object.values(out.packages).some((v) => v !== null && v !== undefined);
				return anyPresent ? { passed: true } : { passed: false, detail: 'all packages null' };
			}
		},
		{
			name: 'at_least_one_site_non_null',
			description: 'catches total Firecrawl failure',
			check: (out) => {
				if (!isObject(out) || !isObject(out.sites))
					return { passed: false, detail: 'sites object missing' };
				const anyPresent = Object.values(out.sites).some((v) => nonEmptyString(v));
				return anyPresent ? { passed: true } : { passed: false, detail: 'all sites null or empty' };
			}
		}
	]
};

// ---------------------------------------------------------------------------
// Suite: trend-report.pipe
// Output shape: ReportData (sections: {executiveSummary, marketSnapshot,
// developerSignals, signalInterpretation, supportingResources})
// ---------------------------------------------------------------------------

export const TREND_REPORT_SUITE: ValidatorSuite = {
	pipelineName: 'trend-report.pipe',
	validators: [
		{
			name: 'executive_summary_non_empty',
			description: 'sections.executiveSummary.text non-empty',
			check: (out) => {
				const data = out as Partial<ReportData>;
				const text = data?.sections?.executiveSummary?.text;
				return nonEmptyString(text)
					? { passed: true }
					: { passed: false, detail: 'executiveSummary.text empty or missing' };
			}
		},
		{
			name: 'all_pass_1_sections_present',
			description: 'marketSnapshot and developerSignals non-null with text',
			check: (out) => {
				const data = out as Partial<ReportData>;
				const sections = data?.sections;
				if (!sections) return { passed: false, detail: 'sections missing' };
				const missing: string[] = [];
				if (!nonEmptyString(sections.marketSnapshot?.text)) missing.push('marketSnapshot');
				if (!nonEmptyString(sections.developerSignals?.text)) missing.push('developerSignals');
				return missing.length === 0
					? { passed: true }
					: { passed: false, detail: `missing or empty: ${missing.join(', ')}` };
			}
		},
		{
			name: 'signal_interpretation_present',
			description:
				'sections.signalInterpretation.text non-empty and has 3-7 interpretation entries',
			check: (out) => {
				const data = out as Partial<ReportData>;
				const section = data?.sections?.signalInterpretation;
				if (!section) return { passed: false, detail: 'signalInterpretation section missing' };
				if (!nonEmptyString(section.text))
					return { passed: false, detail: 'signalInterpretation.text empty or missing' };
				if (!Array.isArray(section.interpretations))
					return { passed: false, detail: 'signalInterpretation.interpretations not an array' };
				const count = section.interpretations.length;
				if (count < 3 || count > 7)
					return { passed: false, detail: `expected 3-7 interpretations, got ${count}` };
				return { passed: true, detail: `${count} interpretations` };
			}
		},
		{
			name: 'supporting_resources_present',
			description: 'sections.supportingResources.resources is an array (up to 10 entries)',
			check: (out) => {
				const data = out as Partial<ReportData>;
				const resources = data?.sections?.supportingResources?.resources;
				if (!Array.isArray(resources))
					return { passed: false, detail: 'supportingResources.resources not an array' };
				if (resources.length > 10)
					return {
						passed: false,
						detail: `supportingResources capped at 10, got ${resources.length}`
					};
				return { passed: true, detail: `${resources.length} resources` };
			}
		},
		{
			name: 'report_data_jsonb_valid',
			description: 'parses, has reportMetadata, sections, and charts top-level keys',
			check: (out) => {
				if (!isObject(out)) return { passed: false, detail: 'not an object' };
				const missing = ['reportMetadata', 'sections', 'charts'].filter((k) => !(k in out));
				return missing.length === 0
					? { passed: true }
					: { passed: false, detail: `missing top-level keys: ${missing.join(', ')}` };
			}
		},
		{
			name: 'predictions_present',
			description: 'executiveSummary.predictions array has at least one entry',
			check: (out) => {
				const data = out as Partial<ReportData>;
				const preds = data?.sections?.executiveSummary?.predictions;
				if (!Array.isArray(preds))
					return { passed: false, detail: 'predictions array missing on executiveSummary' };
				return preds.length >= 1
					? { passed: true, detail: `${preds.length} predictions` }
					: { passed: false, detail: 'predictions array empty' };
			}
		}
	]
};

// ---------------------------------------------------------------------------
// Registry
//
// Phase 5 split content-drafts.pipe into angle-picker.pipe + content-drafter.pipe
// and orchestrates them outside the validateAndPersist code path. Per-pipe
// validation for the new flow lives in content-drafts-orchestrator.ts and the
// runner-level tests, not here.
// ---------------------------------------------------------------------------

export const VALIDATOR_SUITES: Record<string, ValidatorSuite> = {
	'rocketride-context.pipe': ROCKETRIDE_CONTEXT_SUITE,
	'trend-report.pipe': TREND_REPORT_SUITE
};
