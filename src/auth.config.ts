import type { NextAuthConfig } from 'next-auth'

// Edge-safe config: no Prisma-importing providers here. Middleware and
// auth.ts share this; providers and DB-touching callbacks live in auth.ts.
export const authConfig = {
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  callbacks: {
    authorized({ auth }) {
      return !!auth
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      if (token.sid) session.sid = token.sid as string
      return session
    },
  },
  providers: [],
} satisfies NextAuthConfig
