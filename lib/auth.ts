import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const ALLOWED_EMAILS = ["joshua.rocketride@gmail.com"];

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/auth-error",
  },
  callbacks: {
    signIn({ user }) {
      return !!user.email && ALLOWED_EMAILS.includes(user.email);
    },
    authorized({ auth: session }) {
      return !!session?.user;
    },
  },
});
