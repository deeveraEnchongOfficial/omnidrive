import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { getAuthedGoogleClient, syncGoogleQuota } from '@/lib/google'
import { createAuditLog } from '@/lib/audit'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id } = await params
    const session = await prisma.uploadSession.findFirstOrThrow({
      where: { id, userId: user.id }
    })

    const rangeHeader = request.headers.get('content-range')
    if (!rangeHeader) {
      return apiError(400, 'MISSING_CONTENT_RANGE', 'Content-Range header is required.')
    }

    const match = rangeHeader.match(/bytes\s+(\d+)-(\d+)\/(\d+)/)
    if (!match) return apiError(400, 'INVALID_CONTENT_RANGE', 'Invalid Content-Range format.')

    const startByte = BigInt(match[1])
    const endByte = BigInt(match[2])
    const totalBytes = BigInt(match[3])

    if (!session.googleSessionUri || !session.targetConnectedAccountId) {
      return apiError(400, 'UNSUPPORTED_PROVIDER', 'Only Google Drive resumable uploads supported.')
    }

    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: { id: session.targetConnectedAccountId, userId: user.id }
    })
    const auth = await getAuthedGoogleClient(account)
    const drive = google.drive({ version: 'v3', auth })
    const token = await auth.getAccessToken()

    const putHeaders = new Headers()
    putHeaders.set('Authorization', `Bearer ${token.token}`)
    putHeaders.set('Content-Range', rangeHeader)
    putHeaders.set('Content-Length', (endByte - startByte + 1n).toString())

    const putRes = await fetch(session.googleSessionUri, {
      method: 'PUT',
      headers: putHeaders,
      body: request.body,
      duplex: 'half'
    } as RequestInit & { duplex: string })

    if (putRes.status === 308) {
      return NextResponse.json({ status: 'uploading', offset: (endByte + 1n).toString() })
    }

    if (putRes.ok) {
      const fileMeta = await putRes.json() as { id: string; name: string; mimeType: string }

      try {
        await drive.permissions.create({
          fileId: fileMeta.id,
          requestBody: {
            role: 'writer',
            type: 'anyone'
          }
        })
      } catch (err) {
        console.error('Failed to make Google Drive resumable file public:', err instanceof Error ? err.message : err)
      }

      let existingFile = await prisma.file.findFirst({
        where: { providerFileId: fileMeta.id, userId: user.id }
      })

      if (!existingFile) {
        existingFile = await prisma.file.create({
          data: {
            userId: user.id,
            connectedAccountId: account.id,
            folderId: session.folderId,
            provider: 'google_drive',
            providerFileId: fileMeta.id,
            name: fileMeta.name || session.fileName,
            mimeType: fileMeta.mimeType || session.mimeType,
            sizeBytes: totalBytes
          }
        })
      }

      await prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: 'completed', completedAt: new Date() }
      })

      await createAuditLog({ userId: user.id, action: 'UPLOAD_FILE', entityType: 'file', entityId: existingFile.id, metadata: { name: existingFile.name, size: existingFile.sizeBytes.toString() } })
      syncGoogleQuota(account.id).catch(() => undefined)

      return NextResponse.json({ status: 'completed', file: { ...existingFile, sizeBytes: existingFile.sizeBytes.toString() } }, { status: 201 })
    }

    const errorMsg = await putRes.text()
    await prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'failed', errorMessage: errorMsg }
    })

    return NextResponse.json({ code: 'UPLOAD_FAILED', message: errorMsg }, { status: putRes.status })
  } catch (error) {
    return handleRouteError(error)
  }
}
