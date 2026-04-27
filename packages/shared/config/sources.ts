export const redditSubreddits = [
  "opensource",
  "programming",
  "MachineLearning",
  "LocalLLaMA",
  "artificial",
  "devops",
  "rust",
  "golang",
  "node",
  "typescript",
  "webdev",
  "selfhosted",
];

export const githubSearchQueries = [
  "topic:ai+topic:llm",
  "topic:open-source",
  "topic:developer-tools",
];

export const rssSources = [
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
];

export const aiLabFeeds = [
  // Group A: confirmed RSS/Atom feeds
  { name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml", category: "ai-lab" as const },
  { name: "Google Research", url: "https://research.google/blog/rss/", category: "ai-lab" as const },
  { name: "Microsoft Research", url: "https://www.microsoft.com/en-us/research/blog/feed/", category: "ai-lab" as const },
  { name: "Hugging Face", url: "https://huggingface.co/blog/feed.xml", category: "ai-lab" as const },
  { name: "Apple ML Research", url: "https://machinelearning.apple.com/rss.xml", category: "ai-lab" as const },
  { name: "NVIDIA Deep Learning", url: "https://developer.nvidia.com/blog/category/deep-learning/feed/", category: "ai-lab" as const },
  { name: "Berkeley BAIR", url: "https://bair.berkeley.edu/blog/feed.xml", category: "ai-lab" as const },
  { name: "arXiv cs.AI", url: "http://export.arxiv.org/rss/cs.AI", category: "ai-lab" as const },
  { name: "arXiv cs.CL", url: "http://export.arxiv.org/rss/cs.CL", category: "ai-lab" as const },
  { name: "arXiv cs.LG", url: "http://export.arxiv.org/rss/cs.LG", category: "ai-lab" as const },
  // Group B: verified working
  { name: "OpenAI", url: "https://openai.com/news/rss.xml", category: "ai-lab" as const },
  // TODO: no RSS feed available, needs custom adapter or skip
  // { name: "Meta AI", url: "https://ai.meta.com/blog" },
  // { name: "Allen Institute for AI", url: "https://allenai.org/blog" },
  // { name: "IBM Research", url: "https://research.ibm.com/blog" },
  // { name: "Stanford HAI", url: "https://hai.stanford.edu/news" },  // serves Next.js payload, not XML
  // { name: "Anthropic News", url: "https://www.anthropic.com/news" },
  // { name: "Anthropic Research", url: "https://www.anthropic.com/research" },
  // { name: "Anthropic Alignment", url: "https://alignment.anthropic.com/" },
  // { name: "Perplexity", url: "https://www.perplexity.ai/hub" },
  // { name: "Cohere", url: "https://cohere.com/blog" },
  // { name: "Mistral AI", url: "https://mistral.ai/news" },
  // { name: "Stability AI", url: "https://stability.ai/news" },
  // { name: "AI21 Labs", url: "https://www.ai21.com/blog" },
  // { name: "Salesforce AI Research", url: "https://blog.salesforceairesearch.com" },
  // { name: "Qwen", url: "https://qwenlm.github.io" },
  // { name: "xAI", url: "https://x.ai/news" },
  // { name: "DeepSeek", url: "https://api-docs.deepseek.com/news/news" },
];

export const substackPublications = [
  { name: "ByteByteGo", url: "https://blog.bytebytego.com/feed" },
  { name: "The Pragmatic Engineer", url: "https://newsletter.pragmaticengineer.com/feed" },
];

export const mediumTags = [
  "artificial-intelligence",
  "machine-learning",
  "programming",
  "software-engineering",
  "devops",
];

export const hashnodeTag = "ai";

export const arxivCategories = ["cs.AI", "cs.LG", "cs.CL", "cs.SE"];

export const entityList = [
  { name: "OpenAI", type: "company" as const },
  { name: "Anthropic", type: "company" as const },
  { name: "Google", type: "company" as const },
  { name: "Meta", type: "company" as const },
  { name: "Microsoft", type: "company" as const },
  { name: "Apple", type: "company" as const },
  { name: "Amazon", type: "company" as const },
  { name: "NVIDIA", type: "company" as const },
  { name: "Hugging Face", type: "company" as const },
  { name: "Mistral", type: "company" as const },
  { name: "Cohere", type: "company" as const },
  { name: "Stability AI", type: "company" as const },
  { name: "GPT-4", type: "model" as const },
  { name: "GPT-4o", type: "model" as const },
  { name: "Claude", type: "model" as const },
  { name: "Gemini", type: "model" as const },
  { name: "Llama", type: "model" as const },
  { name: "Mistral", type: "model" as const },
  { name: "DALL-E", type: "model" as const },
  { name: "Stable Diffusion", type: "model" as const },
  { name: "Midjourney", type: "model" as const },
  { name: "Whisper", type: "model" as const },
  { name: "LangChain", type: "tool" as const },
  { name: "LlamaIndex", type: "tool" as const },
  { name: "Docker", type: "tool" as const },
  { name: "Kubernetes", type: "tool" as const },
  { name: "Terraform", type: "tool" as const },
  { name: "Rust", type: "language" as const },
  { name: "Python", type: "language" as const },
  { name: "TypeScript", type: "language" as const },
  { name: "Go", type: "language" as const },
  { name: "Zig", type: "language" as const },
  { name: "RAG", type: "concept" as const },
  { name: "fine-tuning", type: "concept" as const },
  { name: "transformer", type: "concept" as const },
  { name: "vector database", type: "concept" as const },
  { name: "embeddings", type: "concept" as const },
  { name: "RLHF", type: "concept" as const },
  { name: "prompt engineering", type: "concept" as const },
  { name: "agentic", type: "concept" as const },
  { name: "MCP", type: "concept" as const },
];

export const stopwords = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "as", "be", "was", "were",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  "dare", "ought", "used", "this", "that", "these", "those", "i", "me",
  "my", "we", "our", "you", "your", "he", "him", "his", "she", "her",
  "its", "they", "them", "their", "what", "which", "who", "whom",
  "where", "when", "why", "how", "all", "each", "every", "both",
  "few", "more", "most", "other", "some", "such", "no", "nor", "not",
  "only", "own", "same", "so", "than", "too", "very", "just", "about",
  "above", "after", "again", "also", "any", "because", "before",
  "below", "between", "during", "here", "into", "out", "over", "then",
  "there", "through", "under", "up", "are", "if", "http", "https",
  "www", "com", "org", "new", "one", "two", "get", "like", "use",
  "using", "don", "ve", "re", "ll", "amp",
]);
