import { buildDashboardView } from '@pulsar/app-market-analysis/views/dashboardView';
import Renderer from '@/components/viewModel/Renderer';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
	const vm = await buildDashboardView();
	return <Renderer vm={vm} />;
}
