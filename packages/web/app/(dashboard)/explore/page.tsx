import { buildExploreView } from '@pulsar/app-market-analysis/views/exploreView';
import Renderer from '@/components/viewModel/Renderer';

export const dynamic = 'force-dynamic';

export default async function ExplorePage() {
	const vm = await buildExploreView();
	return <Renderer vm={vm} />;
}
