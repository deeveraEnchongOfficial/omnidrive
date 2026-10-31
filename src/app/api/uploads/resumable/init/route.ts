import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { env } from '@/lib/env'
import { ensureGoogleAppFolder, getAuthedGoogleClient } from '@/lib/google'
import { selectAccount } from '@/lib/upload'

export async function POST(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = z.object({
      fileName: z.string().min(1),
      mimeType: z.string().min(1),
      sizeBytes: z.string(),
      folderId: z.string().nullable().optional(),
      targetAccountId: z.string().nullable().optional()
    }).parse(await request.json())

    const sizeBytes = BigInt(body.sizeBytes)
    if (sizeBytes <= 0n) return apiError(400, 'UPLOAD_SIZE_REQUIRED', 'Valid sizeBytes required.')
    if (sizeBytes > BigInt(env.MAX_UPLOAD_BYTES)) return apiError(400, 'UPLOAD_TOO_LARGE', 'File exceeds max upload size.')

    const folderId = body.folderId || null
    let targetAccountId = body.targetAccountId
    if (folderId) {
      const folderRecord = await prisma.folder.findFirstOrThrow({ where: { id: folderId, userId: user.id, deletedAt: null } })
      if (folderRecord.connectedAccountId) {
        targetAccountId = folderRecord.connectedAccountId
      }
    }

    const account = await selectAccount(user.id, sizeBytes, undefined, targetAccountId)
    if (!account) return apiError(400, 'NO_ACCOUNT_WITH_ENOUGH_SPACE', 'No connected storage account has enough space.')

    if (account.provider !== 'google_drive') {
      const session = await prisma.uploadSession.create({
        data: {
          userId: user.id,
          targetConnectedAccountId: account.id,
          folderId,
          fileName: body.fileName,
          mimeType: body.mimeType,
          sizeBytes,
          status: 'uploading'
        }
      })
      return NextResponse.json({ sessionId: session.id, provider: account.provider, offset: 0 }, { status: 201 })
    }

    const auth = await getAuthedGoogleClient(account)
    const appFolderId = await ensureGoogleAppFolder(account)
    let targetParentId = appFolderId
    if (folderId) {
      const folderRecord = await prisma.folder.findFirst({ where: { id: folderId, userId: user.id } })
      if (folderRecord?.providerFolderId) {
        targetParentId = folderRecord.providerFolderId
      }
    }

    const headers = new Headers()
    const token = await auth.getAccessToken()
    headers.set('Authorization', `Bearer ${token.token}`)
    headers.set('Content-Type', 'application/json')
    headers.set('X-Upload-Content-Type', body.mimeType)
    headers.set('X-Upload-Content-Length', sizeBytes.toString())

    const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: body.fileName,
        parents: [targetParentId]
      })
    })

    if (!initRes.ok) {
      const errText = await initRes.text()
      throw new Error(`Google API Init Error: ${errText}`)
    }

    const sessionUri = initRes.headers.get('location')
    if (!sessionUri) throw new Error('Google API did not return Location header.')

    const session = await prisma.uploadSession.create({
      data: {
        userId: user.id,
        targetConnectedAccountId: account.id,
        folderId,
        fileName: body.fileName,
        mimeType: body.mimeType,
        sizeBytes,
        status: 'uploading',
        googleSessionUri: sessionUri
      }
    })

    return NextResponse.json({ sessionId: session.id, provider: 'google_drive', offset: 0 }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
