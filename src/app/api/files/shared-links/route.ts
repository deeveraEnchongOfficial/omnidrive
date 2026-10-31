import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'

export async function GET(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const shares = await prisma.fileShare.findMany({
      where: { userId: user.id, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { file: { include: { connectedAccount: { select: { email: true, provider: true } }, folder: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'desc' },
    })
    const origin = new URL(request.url).origin
    return NextResponse.json({
      shares: shares.filter((share) => share.file.status === 'active').map((share) => {
        const url = share.token ? `${origin}/f/${share.token}` : null
        return {
          id: share.id,
          url,
          createdAt: share.createdAt.toISOString(),
          expiresAt: share.expiresAt?.toISOString() ?? null,
          file: { ...share.file, sizeBytes: share.file.sizeBytes.toString() },
        }
      })
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
