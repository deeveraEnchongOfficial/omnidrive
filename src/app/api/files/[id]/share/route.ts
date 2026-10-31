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
    const existingShare = await prisma.fileShare.findFirst({ where: { fileId: file.id, userId: user.id, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' } })

    let shareId = existingShare?.id
    let token = existingShare?.token
    if (!existingShare) {
      token = randomToken(32)
      const share = await prisma.fileShare.create({ data: { fileId: file.id, userId: user.id, token, tokenHash: hashToken(token) } })
      shareId = share.id
    }

    const origin = new URL(request.url).origin
    return NextResponse.json({ url: `${origin}/f/${token}`, shareId }, { status: existingShare ? 200 : 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id } = await params
    await prisma.fileShare.updateMany({ where: { fileId: id, userId: user.id, enabled: true }, data: { enabled: false } })
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    return handleRouteError(error)
  }
}
