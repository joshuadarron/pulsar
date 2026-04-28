'use client';

import type { ReportData } from '@pulsar/shared/types';
import ReportTemplate from './ReportTemplate';

export default function ReportView({
	data,
	reportId,
	generatedAt
}: { data: ReportData; reportId: string; generatedAt?: string }) {
	return (
		<div className="space-y-6">
			<ReportTemplate data={data} variant="ui" reportId={reportId} generatedAt={generatedAt} />
		</div>
	);
}
