import { type NextRequest, NextResponse } from 'next/server';
import { listRegisteredViews, resolveView } from '@/lib/viewRegistry';

export const dynamic = 'force-dynamic';

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ path: string[] }> }
) {
	const { path } = await params;
	if (path.length === 0) {
		return NextResponse.json({ views: listRegisteredViews() });
	}

	const [viewId, ...rest] = path;
	const param = rest[0];

	const result = await resolveView(viewId, param, request.nextUrl.searchParams);
	if (!result.ok) {
		return NextResponse.json({ error: result.error }, { status: result.status });
	}
	return NextResponse.json(result.vm);
}
