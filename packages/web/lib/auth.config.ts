import type { NextAuthConfig } from 'next-auth';
import GitHub from 'next-auth/providers/github';

/**
 * Edge-safe NextAuth config consumed by middleware.ts.
 *
 * Must not import any Node-only modules (fs, path, pg, etc.) directly or
 * transitively, since middleware runs in the Edge runtime. The Node-runtime
 * extensions (signIn callback that reads operator context) live in auth.ts.
 */
export const authConfig = {
	providers: [
		GitHub({
			clientId: process.env.GITHUB_CLIENT_ID!,
			clientSecret: process.env.GITHUB_CLIENT_SECRET!
		})
	],
	pages: {
		signIn: '/login',
		error: '/auth-error'
	},
	callbacks: {
		authorized({ auth: session }) {
			return !!session?.user;
		}
	}
} satisfies NextAuthConfig;
