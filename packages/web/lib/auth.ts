import { loadOperatorContext } from '@pulsar/context';
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';

const ALLOWED_USERS: string[] = (() => {
	try {
		return loadOperatorContext().allowedGitHubLogins.map((login) => login.toLowerCase());
	} catch (err) {
		console.warn(
			'[auth] Operator context not configured, GitHub sign-in will reject all logins. Run pnpm setup to configure.',
			err instanceof Error ? err.message : err
		);
		return [];
	}
})();

export const { handlers, auth, signIn, signOut } = NextAuth({
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
		signIn({ profile }) {
			const username = (profile as { login?: string })?.login?.toLowerCase();
			return !!username && ALLOWED_USERS.includes(username);
		},
		authorized({ auth: session }) {
			return !!session?.user;
		}
	}
});
