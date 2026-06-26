import { buildDraftsViewerView } from '@pulsar/app-market-analysis/views/draftsViewerView';
import { notFound } from 'next/navigation';
import Renderer from '@/components/viewModel/Renderer';

export const dynamic = 'force-dynamic';

export default async function DraftsViewerPage({
	params
}: {
	params: Promise<{ reportId: string }>;
}) {
	const { reportId } = await params;
	const vm = await buildDraftsViewerView(reportId);
	if (!vm) notFound();
	return <Renderer vm={vm} />;
}
