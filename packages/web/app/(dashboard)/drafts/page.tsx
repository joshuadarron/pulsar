import { buildDraftsListView } from '@pulsar/app-market-analysis/views/draftsView';
import Renderer from '@/components/viewModel/Renderer';

export const dynamic = 'force-dynamic';

export default async function DraftsListPage() {
	const vm = await buildDraftsListView();
	return <Renderer vm={vm} />;
}
