import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'

const typeFilters: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  video: ['video/mp4', 'video/mpeg', 'video/ogg', 'video/quicktime', 'video/webm'],
  pdf: ['application/pdf'],
  doc: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
  archive: ['application/zip', 'application/x-rar-compressed', 'application/x-tar', 'application/x-7z-compressed']
}

export async function GET(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { searchParams } = new URL(request.url)
    const query = z.object({
      folderId: z.string().optional(),
      q: z.string().trim().max(255).optional(),
      kind: z.enum(['image', 'video', 'pdf', 'doc', 'archive']).optional(),
      starred: z.enum(['true', 'false']).optional(),
      accountId: z.string().optional(),
      minSize: z.coerce.number().optional(),
      maxSize: z.coerce.number().optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional()
    }).parse(Object.fromEntries(searchParams))

    const files = await prisma.file.findMany({
      where: {
        userId: user.id,
        status: 'active',
        ...(query.folderId ? { folderId: query.folderId } : {}),
        ...(query.q ? { name: { contains: query.q } } : {}),
        ...(query.accountId ? { connectedAccountId: query.accountId } : {}),
        ...(query.kind ? { mimeType: { in: typeFilters[query.kind] || [] } } : {}),
        ...(query.starred === 'true' ? { starredAt: { not: null } } : {}),
        ...(query.minSize !== undefined || query.maxSize !== undefined ? {
          sizeBytes: {
            ...(query.minSize !== undefined ? { gte: BigInt(query.minSize) } : {}),
            ...(query.maxSize !== undefined ? { lte: BigInt(query.maxSize) } : {})
          }
        } : {}),
        ...(query.startDate || query.endDate ? {
          createdAt: {
            ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
            ...(query.endDate ? { lte: new Date(query.endDate) } : {})
          }
        } : {})
      },
      include: {
        connectedAccount: { select: { id: true, email: true, provider: true } },
        folder: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
    return NextResponse.json({ files: files.map((file) => ({ ...file, sizeBytes: file.sizeBytes.toString() })) })
  } catch (error) {
    return handleRouteError(error)
  }
}
