import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { hashToken, randomToken } from '@/lib/crypto'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id } = await params
    const file = await prisma.file.findFirstOrThrow({ where: { id, userId: user.id, status: 'active' } })
    const token = randomToken(32)
    await prisma.filePreviewToken.create({ data: { fileId: file.id, userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 10 * 60_000) } })
    const origin = new URL(request.url).origin
    const path = `/api/files/preview/${token}`
    return NextResponse.json({ path, url: `${origin}${path}` }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
