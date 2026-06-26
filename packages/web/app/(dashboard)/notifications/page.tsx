import { buildNotificationsView } from '@pulsar/app-market-analysis/views/notificationsView';
import Renderer from '@/components/viewModel/Renderer';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
	const vm = await buildNotificationsView();
	return <Renderer vm={vm} />;
}
