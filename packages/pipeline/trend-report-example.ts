// ---------------------------------------------------------------------------
// Example payloads for a full Phase 4 trend-report cycle.
//
// All values are illustrative. Numbers are round and clearly synthetic.
// Use this as a reference for expected input/output shapes, not as test data.
// ---------------------------------------------------------------------------

import type { ReportData } from '@pulsar/shared/types';

/**
 * Example input: what the runner queries from Neo4j + PostgreSQL
 * and partitions into per-section data before sending to RocketRide.
 */
export const EXAMPLE_INPUT = {
	// Shared metadata (populated by runner, not sent to agent)
	metadata: {
		periodStart: '2026-04-14T00:00:00.000Z',
		periodEnd: '2026-04-21T00:00:00.000Z',
		articleCount: 340,
		sourcesCount: 8
	},

	// Pass 1, Section: market_snapshot receives this data
	marketSnapshot: {
		entityImportance: [
			{
				name: 'LangChain',
				type: 'tool',
				pagerank_score: 0.18,
				pagerank_rank: 1,
				mention_count: 85,
				history: {
					twelveMonthDelta: -0.12,
					yoyDelta: -0.08,
					trajectory: [
						{ period: '2026-02', mentions: 95, centrality: 0.21 },
						{ period: '2026-03', mentions: 90, centrality: 0.2 },
						{ period: '2026-04', mentions: 85, centrality: 0.18 }
					]
				}
			},
			{
				name: 'CrewAI',
				type: 'tool',
				pagerank_score: 0.09,
				pagerank_rank: 4,
				mention_count: 35,
				history: {
					twelveMonthDelta: 1.4,
					yoyDelta: 0.9,
					trajectory: [
						{ period: '2026-02', mentions: 18, centrality: 0.05 },
						{ period: '2026-03', mentions: 28, centrality: 0.07 },
						{ period: '2026-04', mentions: 35, centrality: 0.09 }
					]
				}
			}
		],
		sourceDistribution: [
			{ source: 'Reddit', articleCount: 95 },
			{ source: 'Hacker News', articleCount: 70 },
			{ source: 'GitHub', articleCount: 55 },
			{ source: 'ArXiv', articleCount: 40 }
		],
		topicClusters: [
			{
				cluster_id: 1,
				topic_count: 12,
				topics: [
					{ name: 'Agent Frameworks', trend_score: 8.5 },
					{ name: 'Model Context Protocol', trend_score: 7.8 },
					{ name: 'Tool Use', trend_score: 6.4 }
				]
			}
		]
	},

	// Pass 1, Section: developer_signals receives this data
	developerSignals: {
		sentimentBreakdown: { positive: 105, negative: 50, neutral: 185 },
		topDiscussions: [
			{
				title: 'Comparing agent framework deployment patterns',
				url: 'https://reddit.com/r/LocalLLaMA/example1',
				commentCount: 150,
				source: 'Reddit'
			},
			{
				title: 'MCP is the USB-C of AI tooling',
				url: 'https://news.ycombinator.com/item?id=example2',
				commentCount: 95,
				source: 'Hacker News'
			}
		],
		emergingEntities: [
			{
				name: 'Semantic Kernel',
				type: 'tool',
				current_rank: 7,
				prior_rank: 28,
				current_mentions: 32,
				prior_mentions: 12,
				mention_growth_multiplier: 2.67
			}
		]
	}
};

/**
 * Example output from each pass (what the agent returns via RocketRide).
 */
export const EXAMPLE_PASS_OUTPUTS = {
	// Pass 1 returns
	marketSnapshot: {
		text: "Orchestration is fragmenting. LangChain held PageRank rank 1, but CrewAI grew mention volume 1.4x year-over-year, climbing into the top five. The challenger frameworks (CrewAI, AutoGen, Semantic Kernel) collectively matched 76 percent of LangChain's volume this period, up from roughly half last quarter.\n\nFor RocketRide-class runtimes, the read is simple: when the framework layer becomes interchangeable, runtime positioning lands harder. Reddit (95) and Hacker News (70) drive the conversation; GitHub (55) overtook ArXiv (40), reflecting a shift from research to implementation.",
		research: [
			{
				url: 'https://github.com/langchain-ai/langchain/releases',
				sourceType: 'repository' as const,
				claimSupported: 'LangChain release cadence has held steady this period',
				excerpt: 'v0.3.x release series continues with weekly patch releases.',
				retrievedAt: '2026-04-21T10:00:00.000Z'
			}
		]
	},

	developerSignals: {
		text: 'The dominant question on r/LocalLLaMA this period was how to deploy multi-step agents without per-framework configuration drift. The top thread (150 comments) compared three orchestration patterns and converged on a complaint: tool integration is solved at the model layer but unsolved at the runtime layer.\n\nSemantic Kernel emerged into the top 10 of PageRank importance from rank 28 last week, with mention volume up 2.67x. The driver appears to be its plugin model fitting cleanly into existing .NET shops, not a fresh marketing push.',
		research: [
			{
				url: 'https://reddit.com/r/LocalLLaMA/example1',
				sourceType: 'social' as const,
				claimSupported:
					'Configuration complexity is the dominant complaint in agent framework discussions',
				excerpt:
					'Top comment: "I spent more time configuring LangChain to talk to my tools than building the actual agent logic."',
				retrievedAt: '2026-04-21T10:15:00.000Z'
			}
		]
	},

	// Pass 2 returns (reads pass-1 text)
	signalInterpretation: {
		text: 'These are the data points worth interpreting this period. Each links a concrete signal to what it implies for the operator.',
		interpretations: [
			{
				signal:
					'Challenger frameworks (CrewAI, AutoGen, Semantic Kernel) collectively matched 76 percent of LangChain mention volume.',
				meaning:
					'Developers are not consolidating around one framework. The framework layer is becoming interchangeable.',
				implication:
					'Runtime positioning lands harder when the layer above is swappable. The "framework choice matters less than runtime" argument has the most leverage right now.'
			},
			{
				signal:
					'Semantic Kernel jumped from PageRank rank 28 to rank 7, with 2.67x mention growth.',
				meaning:
					'A second-tier framework can break into the top tier in one period when the underlying ecosystem (here, .NET) is ready.',
				implication:
					'Watch for similar emergences in adjacent ecosystems. Cross-runtime portability stories matter when developers are migrating frameworks weekly.'
			},
			{
				signal:
					'150-comment r/LocalLLaMA thread on agent deployment converged on configuration complexity as the unsolved problem.',
				meaning: 'The bottleneck has moved from model selection to integration plumbing.',
				implication:
					'Demonstrations should show end-to-end deployment, not isolated capability. Show the wiring, not the model call.'
			}
		]
	},

	// Pass 3 returns (reads pass 1 + pass 2 text)
	executiveSummary: {
		text: "Orchestration fragmented this period: three challenger frameworks collectively matched 76 percent of LangChain's mention volume, and the dominant developer thread (150 comments) named tool integration as the unsolved runtime problem. Semantic Kernel emerged from rank 28 to rank 7 in one week. The window for runtime positioning is open while developers are still picking. The argument that framework choice matters less than runtime has the most leverage right now.",
		predictions: [
			{
				prediction_text:
					'MCP-compatible tool wrappers will appear for the top three agent frameworks within four weeks.',
				predicted_entities: ['LangChain', 'MCP'],
				predicted_topics: ['agent frameworks', 'tool integration'],
				prediction_type: 'emergence' as const
			}
		]
	},

	// Pass 4 returns (ranks the aggregated research pool)
	supportingResources: {
		resources: [
			{
				url: 'https://github.com/langchain-ai/langchain/releases',
				title: 'LangChain release notes',
				why: 'Canonical record of LangChain release cadence; useful for verifying claims about ecosystem velocity.'
			},
			{
				url: 'https://reddit.com/r/LocalLLaMA/example1',
				title: 'Comparing agent framework deployment patterns',
				why: '150-comment thread anchoring the runtime-layer complaint cited in the report.'
			}
		]
	}
};

/**
 * Example assembled report_data: the final JSONB stored in the reports table.
 * Constructed by the runner from pass outputs + queried data.
 */
export const EXAMPLE_REPORT_DATA: ReportData = {
	reportMetadata: {
		periodStart: EXAMPLE_INPUT.metadata.periodStart,
		periodEnd: EXAMPLE_INPUT.metadata.periodEnd,
		sourcesCount: EXAMPLE_INPUT.metadata.sourcesCount,
		articleCount: EXAMPLE_INPUT.metadata.articleCount
	},
	sections: {
		executiveSummary: {
			text: EXAMPLE_PASS_OUTPUTS.executiveSummary.text,
			predictions: EXAMPLE_PASS_OUTPUTS.executiveSummary.predictions
		},
		marketSnapshot: {
			text: EXAMPLE_PASS_OUTPUTS.marketSnapshot.text,
			research: EXAMPLE_PASS_OUTPUTS.marketSnapshot.research
		},
		developerSignals: {
			text: EXAMPLE_PASS_OUTPUTS.developerSignals.text,
			research: EXAMPLE_PASS_OUTPUTS.developerSignals.research
		},
		signalInterpretation: {
			text: EXAMPLE_PASS_OUTPUTS.signalInterpretation.text,
			interpretations: EXAMPLE_PASS_OUTPUTS.signalInterpretation.interpretations
		},
		supportingResources: {
			resources: EXAMPLE_PASS_OUTPUTS.supportingResources.resources
		}
	},
	charts: {
		keywordDistribution: {
			windowStart: '2026-03-22T00:00:00.000Z',
			windowEnd: '2026-04-21T00:00:00.000Z',
			totalArticles: 1280,
			buckets: [
				{ keyword: 'agent', count: 320, pct: 25 },
				{ keyword: 'rag', count: 220, pct: 17.18 },
				{ keyword: 'mcp', count: 165, pct: 12.89 },
				{ keyword: 'tool-use', count: 110, pct: 8.59 },
				{ keyword: 'embeddings', count: 95, pct: 7.42 },
				{ keyword: 'Other', count: 370, pct: 28.91 }
			]
		},
		entityCentrality: {
			currentPeriodEnd: '2026-04-21T00:00:00.000Z',
			periodKind: 'month',
			sparse: false,
			series: [
				{
					entityName: 'LangChain',
					points: [
						{ period: '2026-02', centrality: 0.21, mentions: 95 },
						{ period: '2026-03', centrality: 0.2, mentions: 90 },
						{ period: '2026-04', centrality: 0.18, mentions: 85 }
					]
				},
				{
					entityName: 'CrewAI',
					points: [
						{ period: '2026-02', centrality: 0.05, mentions: 18 },
						{ period: '2026-03', centrality: 0.07, mentions: 28 },
						{ period: '2026-04', centrality: 0.09, mentions: 35 }
					]
				}
			]
		}
	}
};
