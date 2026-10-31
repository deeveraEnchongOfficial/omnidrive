import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { hashToken } from '@/lib/crypto'
import { connectGoogleDriveAccount, createOAuthClient, syncGoogleQuota } from '@/lib/google'

const querySchema = z.object({ code: z.string(), state: z.string() })

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = url.origin
  try {
    const query = querySchema.parse(Object.fromEntries(url.searchParams))
    const oauthState = await prisma.oauthState.findUniqueOrThrow({ where: { stateHash: hashToken(query.state) }, include: { providerConfig: true } })
    if (oauthState.usedAt || oauthState.expiresAt < new Date()) {
      return NextResponse.json({ code: 'GOOGLE_OAUTH_STATE_INVALID', message: 'OAuth state expired.' }, { status: 400 })
    }
    const client = createOAuthClient(oauthState.providerConfig)
    const tokenResult = await client.getToken(query.code)
    const tokens = tokenResult.tokens
    if (!tokens.access_token) {
      return NextResponse.json({ code: 'GOOGLE_OAUTH_FAILED', message: 'Google did not return required tokens.' }, { status: 400 })
    }
    client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const profile = await oauth2.userinfo.get()
    const providerAccountId = profile.data.id
    const email = profile.data.email
    if (!providerAccountId || !email) {
      return NextResponse.json({ code: 'GOOGLE_PROFILE_FAILED', message: 'Google profile missing id or email.' }, { status: 400 })
    }

    // App sign-in goes through Auth.js; this callback only handles the
    // 'connect' flow (linking an additional Drive account).
    if (oauthState.flow !== 'connect' || !oauthState.userId) {
      return NextResponse.json({ code: 'GOOGLE_OAUTH_STATE_INVALID', message: 'OAuth state expired.' }, { status: 400 })
    }

    const account = await connectGoogleDriveAccount({
      userId: oauthState.userId,
      providerConfigId: oauthState.providerConfigId,
      profile: { id: providerAccountId, email, name: profile.data.name, picture: profile.data.picture },
      tokens: { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expiry_date: tokens.expiry_date },
      scopes: oauthState.providerConfig.scopes as string[],
    })
    await prisma.oauthState.update({ where: { id: oauthState.id }, data: { usedAt: new Date() } })
    await syncGoogleQuota(account.id).catch(() => undefined)
    return NextResponse.redirect(`${origin}/google-connected?status=success`)
  } catch (error) {
    console.error('Google OAuth callback failed:', error)
    return NextResponse.redirect(`${origin}/google-connected?status=error`)
  }
}
