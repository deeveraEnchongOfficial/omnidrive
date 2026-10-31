import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { syncGoogleAppFolderFiles, syncGoogleSharedFiles, syncGoogleStarredFiles, type GoogleAppFolderSyncResult, type SharedSyncResult } from '@/lib/google'

export async function POST(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = z.object({ connectedAccountId: z.string().min(1).optional() }).parse(await request.json().catch(() => ({})))
    const accounts = await prisma.connectedAccount.findMany({
      where: { userId: user.id, provider: 'google_drive', status: 'connected', ...(body.connectedAccountId ? { id: body.connectedAccountId } : {}) },
      select: { id: true },
    })

    const results: Array<GoogleAppFolderSyncResult & { shared?: SharedSyncResult; starred?: SharedSyncResult; error?: string }> = []
    for (const account of accounts) {
      try {
        const result = await syncGoogleAppFolderFiles(account.id, user.id)
        try {
          const [shared, starred] = await Promise.all([
            syncGoogleSharedFiles(account.id, user.id).catch((e) => ({ accountId: account.id, created: 0, updated: 0, deleted: 0, skipped: 'scope' as const, error: e instanceof Error ? e.message : 'Shared sync failed' })),
            syncGoogleStarredFiles(account.id, user.id).catch((e) => ({ accountId: account.id, created: 0, updated: 0, deleted: 0, skipped: 'scope' as const, error: e instanceof Error ? e.message : 'Starred sync failed' })),
          ])
          results.push({ ...result, shared, starred })
        } catch (sharedError) {
          results.push({ ...result, error: sharedError instanceof Error ? sharedError.message : 'Shared files sync failed' })
        }
      } catch (error) {
        results.push({ accountId: account.id, created: 0, updated: 0, deleted: 0, error: error instanceof Error ? error.message : 'Sync failed' })
      }
    }

    return NextResponse.json({ status: 'ok', results })
  } catch (error) {
    return handleRouteError(error)
  }
}
