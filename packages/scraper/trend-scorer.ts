import { getSession } from '@pulsar/shared/db/neo4j';
import { env } from '@pulsar/shared/config/env';

export async function updateTrendScores(): Promise<void> {
	const session = getSession();
	const lambda = env.trendScoreLambda;

	try {
		// trendScore = sum(article.score * e^(-lambda * days_since_published))
		await session.run(
			`MATCH (t:Topic)<-[:TAGGED_WITH]-(a:Article)
       WHERE a.publishedAt IS NOT NULL
       WITH t, collect({
         score: coalesce(a.score, 1),
         days: duration.between(a.publishedAt, datetime()).days
       }) AS articles
       WITH t, reduce(s = 0.0, art IN articles |
         s + art.score * exp(-1.0 * $lambda * art.days)
       ) AS newScore
       SET t.trendScore = newScore`,
			{ lambda }
		);

		console.log('Trend scores updated.');
	} finally {
		await session.close();
	}
}
