import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { hashToken, randomToken } from '@/lib/crypto'

const createSchema = z.object({ name: z.string().trim().min(1).max(191), expiresAt: z.string().datetime().nullable().optional() })
const scopes = ['files:upload']

function serializeApiKey(apiKey: { id: string; name: string; keyPrefix: string; scopes: unknown; status: string; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date }) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    scopes: Array.isArray(apiKey.scopes) ? apiKey.scopes : [],
    status: apiKey.status,
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    expiresAt: apiKey.expiresAt?.toISOString() ?? null,
    revokedAt: apiKey.revokedAt?.toISOString() ?? null,
    createdAt: apiKey.createdAt.toISOString(),
  }
}

export async function GET() {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const apiKeys = await prisma.apiKey.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ apiKeys: apiKeys.map(serializeApiKey) })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = createSchema.parse(await request.json())
    const secret = `od_live_${randomToken(32)}`
    const apiKey = await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: body.name,
        keyPrefix: secret.slice(0, 16),
        keyHash: hashToken(secret),
        scopes,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    })
    return NextResponse.json({ apiKey: serializeApiKey(apiKey), secret }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
