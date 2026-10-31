import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { getAuthedGoogleClient } from '@/lib/google'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id } = await params
    const file = await prisma.file.findFirstOrThrow({ where: { id, userId: user.id }, include: { connectedAccount: true } })
    if (file.provider === 's3') return NextResponse.json({ url: null })
    const auth = await getAuthedGoogleClient(file.connectedAccount)
    const drive = google.drive({ version: 'v3', auth })

    try {
      await drive.permissions.create({
        fileId: file.providerFileId,
        requestBody: {
          role: 'writer',
          type: 'anyone'
        }
      })
    } catch (err) {
      console.error('Failed to make Google Drive file public during view-url retrieval:', err instanceof Error ? err.message : err)
    }

    const metadata = await drive.files.get({ fileId: file.providerFileId, fields: 'webViewLink,webContentLink' })
    return NextResponse.json({ url: metadata.data.webViewLink ?? metadata.data.webContentLink })
  } catch (error) {
    return handleRouteError(error)
  }
}
