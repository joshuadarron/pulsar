import { authConfig } from '@/lib/auth.config';
import NextAuth from 'next-auth';

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
	matcher: ['/((?!login|auth-error|api/auth|_next/static|_next/image|favicon.ico).*)']
};
