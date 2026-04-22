// ---------------------------------------------------------------------------
// Example payloads for a full trend-report cycle.
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
		sourcesCount: 8,
	},

	// Pass 1, Section 1: market_landscape receives this data
	marketLandscape: {
		entities: [
			{ name: 'LangChain', type: 'tool', mentionCount: 85 },
			{ name: 'OpenAI', type: 'company', mentionCount: 120 },
			{ name: 'Anthropic', type: 'company', mentionCount: 75 },
			{ name: 'LlamaIndex', type: 'tool', mentionCount: 40 },
			{ name: 'CrewAI', type: 'tool', mentionCount: 35 },
			{ name: 'AutoGen', type: 'tool', mentionCount: 30 },
			{ name: 'Claude', type: 'model', mentionCount: 60 },
			{ name: 'GPT-4o', type: 'model', mentionCount: 55 },
		],
		technologies: [
			{ name: 'LangChain', type: 'tool', mentionCount: 85 },
			{ name: 'Claude', type: 'model', mentionCount: 60 },
			{ name: 'GPT-4o', type: 'model', mentionCount: 55 },
			{ name: 'Python', type: 'language', mentionCount: 110 },
			{ name: 'TypeScript', type: 'language', mentionCount: 45 },
			{ name: 'CrewAI', type: 'tool', mentionCount: 35 },
		],
		sourceDistribution: [
			{ source: 'Reddit', articleCount: 95 },
			{ source: 'Hacker News', articleCount: 70 },
			{ source: 'GitHub', articleCount: 55 },
			{ source: 'ArXiv', articleCount: 40 },
			{ source: 'Dev.to', articleCount: 30 },
			{ source: 'Medium', articleCount: 25 },
			{ source: 'Hashnode', articleCount: 15 },
			{ source: 'RSS/Substack', articleCount: 10 },
		],
	},

	// Pass 1, Section 2: technology_trends receives this data
	technologyTrends: {
		keywords: [
			{ keyword: 'mcp', count7d: 48, count30d: 60, delta: 2.2 },
			{ keyword: 'agent', count7d: 95, count30d: 280, delta: 0.4 },
			{ keyword: 'rag', count7d: 70, count30d: 250, delta: 0.1 },
			{ keyword: 'tool-use', count7d: 35, count30d: 50, delta: 1.8 },
			{ keyword: 'fine-tuning', count7d: 25, count30d: 100, delta: 0.0 },
			{ keyword: 'embeddings', count7d: 30, count30d: 95, delta: 0.3 },
			{ keyword: 'vector-db', count7d: 20, count30d: 80, delta: -0.2 },
			{ keyword: 'prompt-engineering', count7d: 15, count30d: 70, delta: -0.4 },
		],
		topics: [
			{ topic: 'Agent Frameworks', trendScore: 8.5, sentiment: 'positive', articleCount: 45, sparkline: [5, 7, 6, 8, 9, 5, 5] },
			{ topic: 'Model Context Protocol', trendScore: 7.8, sentiment: 'positive', articleCount: 30, sparkline: [2, 3, 4, 5, 6, 4, 6] },
			{ topic: 'RAG Pipelines', trendScore: 6.2, sentiment: 'neutral', articleCount: 38, sparkline: [6, 5, 5, 6, 5, 6, 5] },
			{ topic: 'LLM Deployment', trendScore: 5.5, sentiment: 'neutral', articleCount: 25, sparkline: [4, 3, 4, 4, 3, 4, 3] },
			{ topic: 'Open-source Models', trendScore: 5.0, sentiment: 'positive', articleCount: 20, sparkline: [3, 3, 2, 3, 3, 3, 3] },
		],
		velocityOutliers: [
			{ topic: 'mcp', spike: 48, baseline: 15 },
			{ topic: 'tool-use', spike: 35, baseline: 12 },
		],
		topicCoOccurrence: [
			{ topicA: 'Agent Frameworks', topicB: 'Model Context Protocol', count: 18 },
			{ topicA: 'Agent Frameworks', topicB: 'Tool Use', count: 15 },
			{ topicA: 'RAG Pipelines', topicB: 'Vector Databases', count: 12 },
			{ topicA: 'Model Context Protocol', topicB: 'Tool Use', count: 10 },
		],
		emergingTopics: ['MCP servers', 'agent-to-agent protocols', 'structured outputs'],
	},

	// Pass 1, Section 3: developer_signals receives this data
	developerSignals: {
		sentimentBreakdown: { positive: 105, negative: 50, neutral: 185 },
		topAuthors: [
			{ handle: 'swyx', platform: 'Twitter', articleCount: 8 },
			{ handle: 'simonw', platform: 'Blog', articleCount: 5 },
			{ handle: 'karpathy', platform: 'Twitter', articleCount: 4 },
		],
		topDiscussions: [
			{ title: 'Comparing agent framework deployment patterns', url: 'https://reddit.com/r/LocalLLaMA/example1', commentCount: 150, source: 'Reddit' },
			{ title: 'MCP is the USB-C of AI tooling', url: 'https://news.ycombinator.com/item?id=example2', commentCount: 95, source: 'Hacker News' },
			{ title: 'Why I switched from LangChain to building my own', url: 'https://dev.to/example3', commentCount: 60, source: 'Dev.to' },
		],
	},
};

/**
 * Example output from each pass (what the agent returns via RocketRide).
 */
export const EXAMPLE_PASS_OUTPUTS = {
	// Pass 1 returns (one per section, run in parallel)
	marketLandscape: {
		text: 'The orchestration layer is fragmenting. LangChain still leads entity mentions at 85 this period, but its share is shrinking as CrewAI (35) and AutoGen (30) gain ground. Collectively, the three challenger frameworks now account for 76% of LangChain\'s volume, up from roughly 50% last month. This is not a LangChain decline story; absolute mentions held steady. It is a market-expanding story: more developers are entering the agent space and choosing different tools.\n\nOpenAI (120 mentions) and Anthropic (75) dominate the model provider conversation. The gap between them narrowed by 15 points compared to the prior period, driven largely by Claude\'s tool-use capabilities becoming a reference point in agent framework discussions. GPT-4o mentions (55) are increasingly tied to deployment cost threads rather than capability comparisons.\n\nSource distribution is stable, with Reddit (95) and Hacker News (70) as primary channels. GitHub (55) overtook ArXiv (40) for the third slot, reflecting a shift from research to implementation. For RocketRide, the runtime positioning has a clear window: developers choosing between orchestration options need the layer beneath them to be stable and framework-agnostic.',
		research: [
			{
				url: 'https://github.com/langchain-ai/langchain/releases',
				sourceType: 'repository' as const,
				claimSupported: 'LangChain absolute mentions held steady',
				excerpt: 'v0.3.x release series continues with weekly patch releases, maintaining development velocity.',
				retrievedAt: '2026-04-21T10:00:00.000Z',
			},
		],
	},

	technologyTrends: {
		text: 'MCP (Model Context Protocol) is the period\'s clearest acceleration signal: 48 mentions in 7 days against a 30-day baseline of 15, a 3.2x spike. The keyword co-occurs heavily with "agent" and "tool-use," confirming that developers are evaluating MCP as plumbing for agent tool integration. Sentiment on MCP-related topics runs 71% positive, with the negative fraction (12%) focused on spec stability concerns.\n\nThe "agent" keyword remains the highest-volume term at 95 seven-day mentions, but its delta of 0.4 suggests steady-state growth rather than a spike. "RAG" (70 mentions, delta 0.1) is plateauing, while "prompt-engineering" (15 mentions, delta -0.4) continues its decline. This pattern is consistent: the conversation is shifting from prompting individual models to orchestrating multi-step workflows.\n\nVelocity outliers confirm the theme: "mcp" (3.2x) and "tool-use" (2.9x) are the only two keywords with spike-to-baseline ratios above 2x. Topic co-occurrence data shows "Agent Frameworks" clustering tightly with both "Model Context Protocol" (18 co-occurrences) and "Tool Use" (15), forming a coherent thematic block.\n\nEmerging topics to track: "MCP servers" (developers building tool servers for MCP), "agent-to-agent protocols" (early discussion around agent interop), and "structured outputs" (LLM responses as typed schemas).',
	},

	developerSignals: {
		text: 'Developer sentiment this period breaks down to 54% neutral, 31% positive, and 15% negative. The large neutral share reflects an evaluation mindset: comparison posts, "how do I choose" threads, and architecture decision records outnumber endorsements or complaints.\n\nThe highest-engagement discussion (150 comments on r/LocalLLaMA) compared agent framework deployment patterns. The dominant thread was configuration complexity: developers want to compose agents from reusable components without managing per-framework configuration drift. The second-highest thread (95 comments on Hacker News) framed MCP as "the USB-C of AI tooling," debating whether standardization at the tool-integration layer would reduce framework lock-in.\n\nInfluential voices this period: swyx (8 articles) has been building the case for "AI engineering" as a discipline distinct from ML engineering, with a focus on runtime concerns. simonw (5 articles) published detailed MCP implementation walkthroughs. karpathy (4 posts) commented on the gap between research model capabilities and production deployment tooling.\n\nThe clearest actionable signal: developers are frustrated by the gap between choosing an agent framework and deploying it reliably. Configuration complexity, tool integration, and provider switching are the top three complaints. These map directly to RocketRide\'s pipeline composition model.',
		research: [
			{
				url: 'https://reddit.com/r/LocalLLaMA/example1',
				sourceType: 'social' as const,
				claimSupported: 'Configuration complexity is the dominant complaint in agent framework discussions',
				excerpt: 'Top comment: "I spent more time configuring LangChain to talk to my tools than building the actual agent logic."',
				retrievedAt: '2026-04-21T10:15:00.000Z',
			},
		],
	},

	// Pass 2 returns (receives only the three text outputs above)
	contentRecommendations: {
		text: '1. "Why your agent framework choice matters less than your runtime" (blog post, publish this week). The marketLandscape analysis shows orchestration fragmentation with three frameworks matching 76% of LangChain\'s volume. Target: developers evaluating agent frameworks. Angle: RocketRide sits beneath the framework layer, making the choice swappable. This is time-sensitive while the fragmentation narrative is active.\n\n2. "Building an MCP server with RocketRide in 15 minutes" (tutorial + video). technologyTrends identified MCP as a 3.2x velocity outlier, and developerSignals shows simonw publishing MCP implementation walkthroughs. Target: developers already exploring MCP. Angle: practical, working example using RocketRide\'s pipeline builder. Publish within two weeks to ride the MCP wave.\n\n3. "The configuration complexity tax: a measured comparison" (blog post). developerSignals identified configuration complexity as the top developer complaint (150-comment thread). Target: developers frustrated with framework setup. Angle: show a side-by-side of configuring the same agent workflow in three frameworks vs. RocketRide pipelines. Include actual code.\n\n4. "Agent-to-agent: what the early protocol discussions mean for your stack" (thought leadership post). technologyTrends flagged "agent-to-agent protocols" as an emerging topic. Target: technical leads planning agent architectures. Angle: position RocketRide\'s directed graph model as naturally suited to multi-agent composition.\n\n5. "RAG is not dead, it is becoming infrastructure" (social thread + blog post). technologyTrends shows RAG at plateau (delta 0.1) while agent mentions grow. Target: developers who built RAG systems and wonder what is next. Angle: RAG becomes a component in larger agent pipelines, exactly the model RocketRide supports.\n\nPrioritization: items 1 and 2 are most time-sensitive (responding to active trends). Item 3 has the highest potential resonance given the 150-comment thread. Items 4 and 5 are lower urgency but build long-term positioning.',
	},

	// Pass 3 returns (receives all four text outputs above)
	executiveSummary: {
		text: 'Agent framework fragmentation reached a tipping point this period, with CrewAI, AutoGen, and Semantic Kernel collectively matching 76% of LangChain\'s mention volume. MCP is accelerating at 3.2x the 30-day baseline as developers standardize tool integration plumbing. Developer sentiment is evaluative (54% neutral), with configuration complexity surfacing as the dominant complaint across 150+ comment threads. RocketRide should publish a framework-agnostic runtime positioning piece this week and follow it with an MCP tutorial to capture developers in active evaluation mode.',
	},
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
		articleCount: EXAMPLE_INPUT.metadata.articleCount,
	},
	sections: {
		marketLandscape: {
			data: EXAMPLE_INPUT.marketLandscape,
			text: EXAMPLE_PASS_OUTPUTS.marketLandscape.text,
			research: EXAMPLE_PASS_OUTPUTS.marketLandscape.research,
		},
		technologyTrends: {
			data: EXAMPLE_INPUT.technologyTrends,
			text: EXAMPLE_PASS_OUTPUTS.technologyTrends.text,
		},
		developerSignals: {
			data: EXAMPLE_INPUT.developerSignals,
			text: EXAMPLE_PASS_OUTPUTS.developerSignals.text,
			research: EXAMPLE_PASS_OUTPUTS.developerSignals.research,
		},
		contentRecommendations: {
			text: EXAMPLE_PASS_OUTPUTS.contentRecommendations.text,
		},
		executiveSummary: {
			text: EXAMPLE_PASS_OUTPUTS.executiveSummary.text,
		},
	},
};
