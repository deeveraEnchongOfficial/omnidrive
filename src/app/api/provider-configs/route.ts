import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'

export async function GET() {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const configs = await prisma.providerConfig.findMany({ where: { userId: user.id }, select: { id: true, provider: true, redirectUri: true, scopes: true, status: true, createdAt: true } })
    return NextResponse.json({ configs })
  } catch (error) {
    return handleRouteError(error)
  }
}
