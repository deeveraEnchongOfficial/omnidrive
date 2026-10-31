import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError } from '@/lib/http'
import { getAuthedGoogleClient } from '@/lib/google'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id } = await params
    const session = await prisma.uploadSession.findFirstOrThrow({
      where: { id, userId: user.id }
    })

    if (session.status === 'completed') {
      return NextResponse.json({ status: 'completed', offset: session.sizeBytes.toString() })
    }

    if (!session.googleSessionUri || !session.targetConnectedAccountId) {
      return NextResponse.json({ status: 'uploading', offset: '0' })
    }

    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: { id: session.targetConnectedAccountId, userId: user.id }
    })
    const auth = await getAuthedGoogleClient(account)
    const token = await auth.getAccessToken()

    const queryHeaders = new Headers()
    queryHeaders.set('Authorization', `Bearer ${token.token}`)
    queryHeaders.set('Content-Range', `bytes */${session.sizeBytes}`)

    const queryRes = await fetch(session.googleSessionUri, {
      method: 'PUT',
      headers: queryHeaders
    })

    if (queryRes.status === 308) {
      const range = queryRes.headers.get('range')
      if (range) {
        const parts = range.split('-')
        const lastByte = BigInt(parts[1])
        return NextResponse.json({ status: 'uploading', offset: (lastByte + 1n).toString() })
      }
    } else if (queryRes.ok) {
      return NextResponse.json({ status: 'completed', offset: session.sizeBytes.toString() })
    }

    return NextResponse.json({ status: 'uploading', offset: '0' })
  } catch {
    return NextResponse.json({ status: 'failed', offset: '0' })
  }
}
