import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { decryptText, encryptText } from '@/lib/crypto'

export async function GET(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const config = await prisma.providerConfig.findFirst({
      where: { user: null, provider: 'google_drive', status: 'active' },
      orderBy: { createdAt: 'desc' }
    })

    const origin = new URL(request.url).origin
    const defaultRedirect = `${origin}/api/connected-accounts/google/callback`

    if (!config) {
      return NextResponse.json({ exists: false, defaultRedirectUri: defaultRedirect })
    }

    let clientId = ''
    try {
      clientId = decryptText(config.clientIdEncrypted)
    } catch {
      clientId = ''
    }

    return NextResponse.json({
      exists: true,
      clientId,
      redirectUri: config.redirectUri,
      hasSecret: !!config.clientSecretEncrypted,
      defaultRedirectUri: defaultRedirect
    })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { clientId, clientSecret, redirectUri } = await request.json()

    if (!clientId) {
      return apiError(400, 'BAD_REQUEST', 'Client ID is required.')
    }

    const origin = new URL(request.url).origin
    const defaultRedirect = `${origin}/api/connected-accounts/google/callback`
    const finalRedirectUri = redirectUri || defaultRedirect

    const scopes = [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/drive.file',
    ]

    await prisma.providerConfig.updateMany({
      where: { user: null, provider: 'google_drive', status: 'active' },
      data: { status: 'disabled' }
    })

    let finalSecret = clientSecret
    if (!finalSecret) {
      const oldConfig = await prisma.providerConfig.findFirst({
        where: { user: null, provider: 'google_drive', status: 'disabled' },
        orderBy: { createdAt: 'desc' }
      })
      if (oldConfig) {
        try {
          finalSecret = decryptText(oldConfig.clientSecretEncrypted)
        } catch {
          // ignore
        }
      }
    }

    if (!finalSecret) {
      return apiError(400, 'BAD_REQUEST', 'Client Secret is required for first-time setup.')
    }

    const config = await prisma.providerConfig.create({
      data: {
        provider: 'google_drive',
        clientIdEncrypted: encryptText(clientId),
        clientSecretEncrypted: encryptText(finalSecret),
        redirectUri: finalRedirectUri,
        scopes,
        status: 'active'
      }
    })

    return NextResponse.json({
      status: 'success',
      message: 'Global Google OAuth configuration updated successfully.',
      id: config.id
    }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
