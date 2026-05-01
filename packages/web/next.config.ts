import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	transpilePackages: [
		'@pulsar/shared',
		'@pulsar/context',
		'@pulsar/voice',
		'@pulsar/app-market-analysis'
	],
	serverExternalPackages: ['puppeteer', 'pg', 'neo4j-driver'],
	images: {
		remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }]
	},
	webpack: (config) => {
		config.resolve.extensionAlias = {
			...config.resolve.extensionAlias,
			'.js': ['.ts', '.tsx', '.js'],
			'.mjs': ['.mts', '.mjs']
		};
		return config;
	}
};

export default nextConfig;
