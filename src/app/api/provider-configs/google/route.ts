import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { encryptText } from '@/lib/crypto'

const schema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  redirectUri: z.string().url(),
  scopes: z.array(z.string()).min(1),
})

export async function POST(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = schema.parse(await request.json())
    const config = await prisma.providerConfig.create({
      data: {
        userId: user.id,
        provider: 'google_drive',
        clientIdEncrypted: encryptText(body.clientId),
        clientSecretEncrypted: encryptText(body.clientSecret),
        redirectUri: body.redirectUri,
        scopes: body.scopes,
      },
    })
    return NextResponse.json({ id: config.id, provider: config.provider, redirectUri: config.redirectUri, scopes: config.scopes, status: config.status }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
