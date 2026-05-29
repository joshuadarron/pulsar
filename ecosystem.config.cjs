// ecosystem.config.cjs
const path = require('node:path');

const ROCKETRIDE_SERVER = path.join(
	require('node:os').homedir(),
	'Repositories/RocketRide/rocketride-server/dist/server'
);

// Shared restart policy for the pulsar processes. Without `min_uptime`,
// `restart_delay`, and `exp_backoff_restart_delay`, pm2 will burst-restart
// a crashing process and saturate the error log. On 2026-05-28 the
// scheduler hit 828k restarts in one outage and wrote 900 MB of stacks.
const restartPolicy = {
	autorestart: true,
	min_uptime: '30s',
	restart_delay: 5000,
	exp_backoff_restart_delay: 5000,
	max_restarts: 50
};

module.exports = {
	apps: [
		{
			name: 'rocketride',
			script: './engine',
			args: './ai/eaas.py',
			interpreter: 'none',
			cwd: ROCKETRIDE_SERVER,
			autorestart: true,
			max_memory_restart: '2G'
		},
		{
			name: 'pulsar-web',
			script: 'pnpm',
			args: 'start', // use "dev" for local, "start" after `pnpm build` for prod
			interpreter: 'none',
			cwd: path.join(__dirname, 'packages/web'),
			env: { NODE_ENV: 'production' },
			max_memory_restart: '1G'
		},
		{
			name: 'pulsar-scheduler',
			script: 'pnpm',
			args: 'run scrape-scheduler',
			interpreter: 'none',
			cwd: path.join(__dirname, 'packages/scraper'),
			max_memory_restart: '512M',
			...restartPolicy
		},
		{
			name: 'pulsar-backfill-worker',
			script: 'pnpm',
			args: 'run backfill-worker',
			interpreter: 'none',
			cwd: path.join(__dirname, 'packages/scraper'),
			max_memory_restart: '512M',
			...restartPolicy
		}
	]
};
