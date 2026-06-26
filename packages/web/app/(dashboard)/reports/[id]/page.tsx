import { buildReportView } from '@pulsar/app-market-analysis/views/reportView';
import { query } from '@pulsar/shared/db/postgres';
import type { ReportData } from '@pulsar/shared/types';
import { notFound } from 'next/navigation';
import Renderer from '@/components/viewModel/Renderer';

export const dynamic = 'force-dynamic';

export default async function ReportDetailPage({
	params
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;

	const result = await query<{ report_data: ReportData; generated_at: string }>(
		'SELECT report_data, generated_at FROM reports WHERE id = $1',
		[id]
	);

	if (result.rows.length === 0) notFound();

	const vm = buildReportView(result.rows[0].report_data, {
		reportId: id,
		generatedAt: result.rows[0].generated_at
	});

	return <Renderer vm={vm} />;
}
