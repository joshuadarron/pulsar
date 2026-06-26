import { buildArticlesListView } from '@pulsar/app-market-analysis/views/articlesView';
import Renderer from '@/components/viewModel/Renderer';

export const dynamic = 'force-dynamic';

export default async function ArticlesListPage() {
	const vm = await buildArticlesListView();
	return <Renderer vm={vm} />;
}
