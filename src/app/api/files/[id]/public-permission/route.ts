import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { getAuthedGoogleClient } from '@/lib/google'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id } = await params
    const file = await prisma.file.findFirstOrThrow({ where: { id, userId: user.id }, include: { connectedAccount: true } })
    if (file.provider !== 'google_drive') {
      return apiError(400, 'UNSUPPORTED_PROVIDER', 'Only Google Drive files can be made public.')
    }
    const auth = await getAuthedGoogleClient(file.connectedAccount)
    const drive = google.drive({ version: 'v3', auth })
    await drive.permissions.create({
      fileId: file.providerFileId,
      requestBody: {
        role: 'writer',
        type: 'anyone'
      }
    })
    const metadata = await drive.files.get({ fileId: file.providerFileId, fields: 'webViewLink,webContentLink' })
    return NextResponse.json({ status: 'ok', url: metadata.data.webViewLink ?? metadata.data.webContentLink })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update Google Drive permissions.'
    return NextResponse.json({ code: 'GOOGLE_API_ERROR', message }, { status: 500 })
  }
}
