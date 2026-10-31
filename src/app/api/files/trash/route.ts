import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'

export async function GET(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { searchParams } = new URL(request.url)
    const query = z.object({ q: z.string().trim().max(255).optional() }).parse(Object.fromEntries(searchParams))
    const files = await prisma.file.findMany({
      where: {
        userId: user.id,
        status: 'deleted',
        ...(query.q ? { name: { contains: query.q } } : {})
      },
      include: {
        connectedAccount: { select: { id: true, email: true, provider: true } },
        folder: { select: { id: true, name: true } }
      },
      orderBy: { deletedAt: 'desc' }
    })
    return NextResponse.json({ files: files.map((file) => ({ ...file, sizeBytes: file.sizeBytes.toString() })) })
  } catch (error) {
    return handleRouteError(error)
  }
}
