// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "pulsar-web",
      script: "pnpm",
      args: "start",              // use "dev" for local, "start" after `pnpm build` for prod
      cwd: __dirname,
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
    },
    {
      name: "pulsar-scheduler",
      script: "pnpm",
      args: "run pipeline-scheduler",
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: "512M",
    },
    {
      name: "pulsar-scraper",
      script: "pnpm",
      args: "run scrape",
      cwd: __dirname,
      autorestart: true,          // only if scraper/index.ts self-schedules with node-cron
      max_memory_restart: "512M",
    },
  ],
};
