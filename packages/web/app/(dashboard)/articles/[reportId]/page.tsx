import { buildArticlesViewerView } from '@pulsar/app-market-analysis/views/articlesView';
import { notFound } from 'next/navigation';
import Renderer from '@/components/viewModel/Renderer';

export const dynamic = 'force-dynamic';

export default async function ArticlesViewerPage({
	params
}: {
	params: Promise<{ reportId: string }>;
}) {
	const { reportId } = await params;
	const vm = await buildArticlesViewerView(reportId);
	if (!vm) notFound();
	return <Renderer vm={vm} />;
}
