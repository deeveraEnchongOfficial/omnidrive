import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { syncGoogleQuota } from '@/lib/google'
import { syncS3Quota } from '@/lib/s3'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id } = await params
    const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id, userId: user.id } })
    const quota = account.provider === 's3' ? await syncS3Quota(account.id) : await syncGoogleQuota(account.id)
    return NextResponse.json({
      quota: {
        ...quota,
        totalBytes: quota.totalBytes?.toString() ?? null,
        usedBytes: quota.usedBytes.toString(),
        availableBytes: quota.availableBytes?.toString() ?? null,
        trashBytes: quota.trashBytes?.toString() ?? null,
      },
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
