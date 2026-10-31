import NextAuth from 'next-auth'
import { authConfig } from '@/auth.config'

// Edge middleware: checks the session cookie only (authConfig has no
// Prisma-importing providers). Full session-registry validation happens
// server-side in getAuthUser().
export default NextAuth(authConfig).auth

export const config = {
  matcher: [
    '/',
    '/files/:path*',
    '/recent',
    '/starred',
    '/trash',
    '/archived',
    '/shared',
    '/quota',
    '/activity',
    '/api-keys',
    '/settings',
    '/google-connected',
  ],
}
