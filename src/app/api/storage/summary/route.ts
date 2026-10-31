import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'

export async function GET() {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const accounts = await prisma.connectedAccount.findMany({ where: { userId: user.id, status: 'connected' }, include: { storageAccount: true } })
    const summary = accounts.reduce((acc, account) => {
      const storage = account.storageAccount
      acc.totalBytes += storage?.totalBytes ?? 0n
      acc.usedBytes += storage?.usedBytes ?? 0n
      acc.availableBytes += storage?.availableBytes ?? 0n
      return acc
    }, { totalBytes: 0n, usedBytes: 0n, availableBytes: 0n })

    return NextResponse.json({
      totalBytes: summary.totalBytes.toString(),
      usedBytes: summary.usedBytes.toString(),
      availableBytes: summary.availableBytes.toString(),
      accounts: accounts.map((account) => ({
        id: account.id,
        provider: account.provider,
        email: account.email,
        status: account.status,
        totalBytes: account.storageAccount?.totalBytes?.toString() ?? null,
        usedBytes: account.storageAccount?.usedBytes.toString() ?? '0',
        availableBytes: account.storageAccount?.availableBytes?.toString() ?? null,
        lastSyncedAt: account.storageAccount?.lastSyncedAt ?? null,
      })),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
