import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'

export async function GET() {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    // MongoDB port: groupBy replaces the original MySQL $queryRaw CASE/SUM.
    const rows = await prisma.file.groupBy({
      by: ['mimeType'],
      where: { userId: user.id, status: 'active' },
      _sum: { sizeBytes: true },
    })
    const breakdown = { photo: '0', video: '0', document: '0' }
    for (const row of rows) {
      const bytes = row._sum.sizeBytes ?? 0n
      const kind = row.mimeType.startsWith('image/') ? 'photo' : row.mimeType.startsWith('video/') ? 'video' : 'document'
      breakdown[kind] = (BigInt(breakdown[kind]) + bytes).toString()
    }
    return NextResponse.json(breakdown)
  } catch (error) {
    return handleRouteError(error)
  }
}
