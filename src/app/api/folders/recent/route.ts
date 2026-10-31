import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'

function serializeFolder(folder: { id: string; name: string; color: string; iconUrl?: string | null; parentId?: string | null; providerFolderId?: string | null; createdAt: Date; updatedAt: Date }) {
  return { ...folder, providerFolderId: folder.providerFolderId ?? null, createdAt: folder.createdAt.toISOString(), updatedAt: folder.updatedAt.toISOString() }
}

export async function GET(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') ?? 4), 4)
    const folders = await prisma.folder.findMany({
      where: { userId: user.id, deletedAt: null },
      select: { id: true, name: true, color: true, iconUrl: true, parentId: true, providerFolderId: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    })
    return NextResponse.json({ folders: folders.map(serializeFolder) })
  } catch (error) {
    return handleRouteError(error)
  }
}
