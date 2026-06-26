import { buildFeedView } from '@pulsar/app-market-analysis/views/feedView';
import Renderer from '@/components/viewModel/Renderer';

export const dynamic = 'force-dynamic';

export default async function FeedPage({
	searchParams
}: {
	searchParams: Promise<Record<string, string | undefined>>;
}) {
	const params = await searchParams;
	const vm = await buildFeedView({
		source: params.source,
		sentiment: params.sentiment,
		contentType: params.contentType,
		q: params.q,
		page: Number.parseInt(params.page ?? '1', 10) || 1,
		perPage: Number.parseInt(params.perPage ?? '20', 10) || 20
	});
	return <Renderer vm={vm} />;
}
