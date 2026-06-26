import { buildReportView } from '@pulsar/app-market-analysis/views/reportView';
import type { EvaluationSummary, ReportData } from '@pulsar/shared/types';
import {
	buildPulsarEmailDocument,
	buildPulsarEmailFooter,
	buildPulsarEmailHeader
} from '@pulsar/web/viewModel/chrome';
import { renderViewModelEmail } from '@pulsar/web/viewModel/render-email';

export function renderReportEmail(
	data: ReportData,
	reportId: string,
	generatedAt: string,
	reportUrl: string,
	pdfUrl: string,
	_evaluationSummary?: EvaluationSummary,
	evalsUrl?: string
): string {
	const vm = buildReportView(data, { reportId, generatedAt });
	const chromeOpts = {
		title: vm.title ?? 'Market Analysis Report',
		generatedAt,
		reportUrl,
		pdfUrl,
		evalsUrl
	};
	const body = renderViewModelEmail(vm, {
		header: buildPulsarEmailHeader(chromeOpts),
		footer: buildPulsarEmailFooter(chromeOpts)
	});
	return buildPulsarEmailDocument(body);
}
