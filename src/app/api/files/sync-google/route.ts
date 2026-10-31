import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { syncGoogleAppFolderFiles } from '@/lib/google'

export async function POST(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = z.object({ connectedAccountId: z.string().min(1).optional() }).parse(await request.json().catch(() => ({})))
    const accounts = await prisma.connectedAccount.findMany({
      where: { userId: user.id, provider: 'google_drive', status: 'connected', ...(body.connectedAccountId ? { id: body.connectedAccountId } : {}) },
      select: { id: true },
    })

    const results = []
    for (const account of accounts) results.push(await syncGoogleAppFolderFiles(account.id, user.id))

    return NextResponse.json({ status: 'ok', results })
  } catch (error) {
    return handleRouteError(error)
  }
}
