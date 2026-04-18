import { getSession } from "@/lib/db/neo4j";
import type { ScrapedItem, EntityMention } from "@/types";

export async function writeArticleToGraph(
  item: ScrapedItem,
  articleId: string,
  keywords: string[],
  entities: EntityMention[],
  category: string,
): Promise<void> {
  const session = getSession();
  try {
    // Create Article node
    await session.run(
      `MERGE (a:Article {id: $id})
       SET a.url = $url, a.title = $title, a.publishedAt = datetime($publishedAt),
           a.scrapedAt = datetime(), a.sourcePlatform = $sourcePlatform,
           a.score = $score`,
      {
        id: articleId,
        url: item.url,
        title: item.title,
        publishedAt: item.publishedAt.toISOString(),
        sourcePlatform: item.sourcePlatform,
        score: item.score ?? 0,
      },
    );

    // Create Source node and relationship
    await session.run(
      `MERGE (s:Source {name: $name})
       SET s.platform = $platform, s.type = $category
       WITH s
       MATCH (a:Article {id: $articleId})
       MERGE (a)-[:FROM_SOURCE]->(s)`,
      {
        name: item.sourceName,
        platform: item.sourcePlatform,
        category,
        articleId,
      },
    );

    // Create Author node and relationship
    if (item.author) {
      await session.run(
        `MERGE (au:Author {handle: $handle})
         SET au.platform = $platform
         WITH au
         MATCH (a:Article {id: $articleId})
         MERGE (a)-[:AUTHORED_BY]->(au)`,
        {
          handle: item.author,
          platform: item.sourcePlatform,
          articleId,
        },
      );
    }

    // Create Topic nodes and relationships
    for (const keyword of keywords) {
      await session.run(
        `MERGE (t:Topic {name: $name})
         ON CREATE SET t.firstSeen = datetime(), t.category = $category, t.trendScore = 0
         SET t.lastSeen = datetime()
         WITH t
         MATCH (a:Article {id: $articleId})
         MERGE (a)-[:TAGGED_WITH]->(t)`,
        { name: keyword, category, articleId },
      );
    }

    // Create Entity nodes and relationships
    for (const entity of entities) {
      await session.run(
        `MERGE (e:Entity {name: $name})
         SET e.type = $type
         WITH e
         MATCH (a:Article {id: $articleId})
         MERGE (a)-[:MENTIONS]->(e)`,
        { name: entity.name, type: entity.type, articleId },
      );
    }

    // Topic co-occurrence: link pairs of keywords that appear in the same article
    if (keywords.length > 1) {
      for (let i = 0; i < keywords.length; i++) {
        for (let j = i + 1; j < keywords.length; j++) {
          await session.run(
            `MATCH (t1:Topic {name: $a}), (t2:Topic {name: $b})
             MERGE (t1)-[r:RELATED_TO]-(t2)
             ON CREATE SET r.weight = 1
             ON MATCH SET r.weight = r.weight + 1`,
            { a: keywords[i], b: keywords[j] },
          );
        }
      }
    }
  } finally {
    await session.close();
  }
}
