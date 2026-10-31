import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import argon2 from 'argon2'
import { authConfig } from '@/auth.config'
import { prisma } from './prisma'
import { env } from './env'
import { connectGoogleDriveAccount, GOOGLE_SCOPES, syncGoogleQuota } from './google'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = String(credentials?.email ?? '').toLowerCase().trim()
        const password = String(credentials?.password ?? '')
        if (!email || !password) return null
        const user = await prisma.user.findUnique({ where: { email } })
        if (!user || !user.passwordHash || user.status !== 'active') return null
        const ok = await argon2.verify(user.passwordHash, password)
        if (!ok) return null
        return { id: user.id, email: user.email, name: user.name }
      },
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'consent',
          include_granted_scopes: 'true',
          scope: GOOGLE_SCOPES.join(' '),
        },
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, account, user }) {
      if (!account || !user?.email) return token

      let dbUserId = user.id as string | undefined
      if (account.provider === 'google') {
        const dbUser = await prisma.user.upsert({
          where: { email: user.email.toLowerCase() },
          create: { email: user.email.toLowerCase(), name: user.name || user.email.split('@')[0] },
          update: {},
        })
        dbUserId = dbUser.id

        // Parity: first Google sign-in auto-connects the Drive account.
        if (account.access_token) {
          try {
            const config = await prisma.providerConfig.findFirst({
              where: { user: null, provider: 'google_drive', status: 'active' },
              orderBy: { createdAt: 'desc' },
            })
            const connected = await connectGoogleDriveAccount({
              userId: dbUser.id,
              providerConfigId: config?.id ?? null,
              profile: {
                id: account.providerAccountId,
                email: user.email.toLowerCase(),
                name: user.name,
                picture: user.image,
              },
              tokens: {
                access_token: account.access_token,
                refresh_token: account.refresh_token,
                expiry_date: account.expires_at ? account.expires_at * 1000 : null,
              },
              scopes: (account.scope ?? '').split(' ').filter(Boolean),
            })
            await syncGoogleQuota(connected.id).catch(() => undefined)
          } catch (error) {
            console.error('[auth] google drive auto-connect failed:', error)
          }
        }
      }

      if (!dbUserId) return token
      token.sub = dbUserId
      const session = await prisma.userSession.create({
        data: { userId: dbUserId, expiresAt: new Date(Date.now() + env.SESSION_TTL_DAYS * 86_400_000) },
      })
      token.sid = session.id
      return token
    },
  },
  events: {
    async signOut(message) {
      const token = 'token' in message ? message.token : null
      if (token?.sid) {
        await prisma.userSession.updateMany({
          where: { id: token.sid },
          data: { revokedAt: new Date() },
        }).catch(() => undefined)
      }
    },
  },
})

export type AuthUser = { id: string; sessionId: string }

// Validates the Auth.js session AND the server-side session registry row,
// preserving 9drive's revocation/expiry semantics. Returns null when invalid.
export async function getAuthUser(): Promise<AuthUser | null> {
  const session = await auth()
  const userId = session?.user?.id
  const sid = session?.sid
  if (!userId || !sid) return null
  const row = await prisma.userSession.findUnique({ where: { id: sid } })
  if (!row || row.revokedAt || row.expiresAt < new Date() || row.userId !== userId) return null
  return { id: userId, sessionId: sid }
}
