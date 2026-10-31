import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { accountNeedsReconnect, emailsNeedingReconnect, serializeMirroredFile } from '@/lib/shared-files'

export async function GET() {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')

    const where = { userId: user.id, status: 'active', starred: true, connectedAccount: { status: 'connected' } }
    const [rows, total, accounts] = await Promise.all([
      prisma.mirroredFile.findMany({
        where,
        include: { connectedAccount: { select: { email: true } } },
        orderBy: { sharedAt: 'desc' },
        take: 200,
      }),
      prisma.mirroredFile.count({ where }),
      prisma.connectedAccount.findMany({ where: { userId: user.id, provider: 'google_drive' }, select: { provider: true, status: true, scopes: true, email: true } }),
    ])

    return NextResponse.json({
      files: rows.map(serializeMirroredFile),
      total,
      needsReconnect: accounts.some(accountNeedsReconnect),
      reconnectEmails: emailsNeedingReconnect(accounts),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
