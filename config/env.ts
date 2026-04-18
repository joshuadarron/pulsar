function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const env = {
  postgres: {
    host: optional("POSTGRES_HOST", "localhost"),
    port: parseInt(optional("POSTGRES_PORT", "5432")),
    database: optional("POSTGRES_DB", "pulse"),
    user: optional("POSTGRES_USER", "pulse"),
    password: optional("POSTGRES_PASSWORD", "pulse_dev"),
  },
  neo4j: {
    uri: optional("NEO4J_URI", "bolt://localhost:7687"),
    username: optional("NEO4J_USERNAME", "neo4j"),
    password: optional("NEO4J_PASSWORD", "pulse_dev"),
  },
  rocketride: {
    wsUrl: optional("ROCKETRIDE_WS_URL", "ws://localhost:5565"),
    apiKey: optional("ROCKETRIDE_APIKEY", ""),
  },
  nextauth: {
    secret: optional("NEXTAUTH_SECRET", ""),
    url: optional("NEXTAUTH_URL", "http://localhost:3000"),
  },
  oauth: {
    google: {
      clientId: optional("GOOGLE_CLIENT_ID", ""),
      clientSecret: optional("GOOGLE_CLIENT_SECRET", ""),
    },
    github: {
      clientId: optional("GITHUB_CLIENT_ID", ""),
      clientSecret: optional("GITHUB_CLIENT_SECRET", ""),
    },
  },
  smtp: {
    host: optional("SMTP_HOST", "smtp.gmail.com"),
    port: parseInt(optional("SMTP_PORT", "587")),
    user: optional("SMTP_USER", ""),
    password: optional("SMTP_PASSWORD", ""),
    notifyTo: optional("NOTIFY_EMAIL_TO", ""),
  },
  scraper: {
    cron1: optional("SCRAPER_CRON_1", "0 0 * * *"),
    cron2: optional("SCRAPER_CRON_2", "0 12 * * *"),
    maxItemsPerSource: parseInt(optional("SCRAPER_MAX_ITEMS_PER_SOURCE", "100")),
  },
  pipeline: {
    cron: optional("PIPELINE_CRON", "0 4 * * *"),
  },
  trendScoreLambda: parseFloat(optional("TREND_SCORE_LAMBDA", "0.1")),
} as const;
