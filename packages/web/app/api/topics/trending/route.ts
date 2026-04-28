import { NextResponse } from 'next/server';
import { getSession } from '@pulsar/shared/db/neo4j';

export async function GET() {
	const session = getSession();
	try {
		const result = await session.run(
			`MATCH (t:Topic)
       WHERE t.trendScore > 0
       RETURN t.name AS name, t.trendScore AS trendScore, t.category AS category,
              t.firstSeen AS firstSeen, t.lastSeen AS lastSeen
       ORDER BY t.trendScore DESC LIMIT 50`
		);

		const topics = result.records.map((r) => ({
			name: r.get('name'),
			trendScore: r.get('trendScore'),
			category: r.get('category'),
			firstSeen: r.get('firstSeen')?.toString(),
			lastSeen: r.get('lastSeen')?.toString()
		}));

		return NextResponse.json(topics);
	} finally {
		await session.close();
	}
}
