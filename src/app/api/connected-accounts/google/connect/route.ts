import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { apiError, handleRouteError } from '@/lib/http'
import { createGoogleConnectUrl } from '../connect-url/route'

export async function GET(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { searchParams } = new URL(request.url)
    const { providerConfigId } = z.object({ providerConfigId: z.string().min(1).optional() }).parse(Object.fromEntries(searchParams))
    const url = await createGoogleConnectUrl(user.id, providerConfigId)
    return NextResponse.redirect(url)
  } catch (error) {
    return handleRouteError(error)
  }
}
