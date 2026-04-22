// ecosystem.config.cjs
const path = require("path");

const ROCKETRIDE_SERVER = path.join(
  require("os").homedir(),
  "Repositories/RocketRide/rocketride-server/dist/server",
);

module.exports = {
  apps: [
    {
      name: "rocketride",
      script: "./engine",
      args: "./ai/eaas.py",
      interpreter: "none",
      cwd: ROCKETRIDE_SERVER,
      autorestart: true,
      max_memory_restart: "2G",
    },
    {
      name: "pulsar-web",
      script: "pnpm",
      args: "start",              // use "dev" for local, "start" after `pnpm build` for prod
      interpreter: "none",
      cwd: path.join(__dirname, "packages/web"),
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
    },
    {
      name: "pulsar-scheduler",
      script: "pnpm",
      args: "run scrape-scheduler",
      interpreter: "none",
      cwd: path.join(__dirname, "packages/scraper"),
      autorestart: true,
      max_memory_restart: "512M",
    },
  ],
};
