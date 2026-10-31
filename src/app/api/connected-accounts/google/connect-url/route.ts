import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { createOAuthClient } from '@/lib/google'
import { mergeRequiredScopes } from '@/lib/shared-files'
import { hashToken, randomToken } from '@/lib/crypto'

export async function createGoogleConnectUrl(userId: string, providerConfigId?: string) {
  const config = providerConfigId
    ? await prisma.providerConfig.findFirstOrThrow({ where: { id: providerConfigId, OR: [{ userId }, { user: null }], provider: 'google_drive', status: 'active' } })
    : await prisma.providerConfig.findFirstOrThrow({ where: { user: null, provider: 'google_drive', status: 'active' }, orderBy: { createdAt: 'desc' } })
  const state = randomToken()
  await prisma.oauthState.create({ data: { userId, providerConfigId: config.id, flow: 'connect', stateHash: hashToken(state), expiresAt: new Date(Date.now() + 10 * 60_000) } })
  const client = createOAuthClient(config)
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: mergeRequiredScopes(config.scopes),
    state,
  })
}

export async function GET(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { searchParams } = new URL(request.url)
    const { providerConfigId } = z.object({ providerConfigId: z.string().min(1).optional() }).parse(Object.fromEntries(searchParams))
    const url = await createGoogleConnectUrl(user.id, providerConfigId)
    return NextResponse.json({ url })
  } catch (error) {
    return handleRouteError(error)
  }
}
