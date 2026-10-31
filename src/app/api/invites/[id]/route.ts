import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id } = await params
    const result = await prisma.workspaceInvite.updateMany({ where: { id, inviterId: user.id, revokedAt: null }, data: { status: 'revoked', revokedAt: new Date() } })
    if (result.count === 0) return apiError(404, 'INVITE_NOT_FOUND', 'Invite not found.')
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    return handleRouteError(error)
  }
}
