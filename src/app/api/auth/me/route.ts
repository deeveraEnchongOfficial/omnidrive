import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError } from '@/lib/http'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, name: true, email: true, status: true } })
  if (!dbUser) return apiError(404, 'USER_NOT_FOUND', 'User not found.')
  return NextResponse.json({ user: dbUser })
}
