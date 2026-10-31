import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { getAuthedGoogleClient, syncGoogleQuota } from '@/lib/google'
import { deleteS3Object, syncS3Quota } from '@/lib/s3'
import { createAuditLog } from '@/lib/audit'

export async function DELETE(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = z.object({ fileIds: z.array(z.string().min(1)).min(1).max(100) }).parse(await request.json())
    const files = await prisma.file.findMany({
      where: { id: { in: body.fileIds }, userId: user.id, status: 'deleted' },
      include: { connectedAccount: true }
    })
    const deletedIds: string[] = []
    const syncedAccountIds = new Set<string>()
    const failed: Array<{ fileId: string; message: string }> = []

    for (const file of files) {
      try {
        if (file.provider === 's3') {
          await deleteS3Object(file)
        } else {
          const auth = await getAuthedGoogleClient(file.connectedAccount)
          const drive = google.drive({ version: 'v3', auth })
          await drive.files.delete({ fileId: file.providerFileId })
        }
        deletedIds.push(file.id)
        syncedAccountIds.add(file.connectedAccountId)
        await createAuditLog({ userId: user.id, action: 'PERMANENT_DELETE_FILE', entityType: 'file', entityId: file.id, metadata: { name: file.name } })
      } catch (error) {
        failed.push({ fileId: file.id, message: error instanceof Error ? error.message : 'Delete failed' })
      }
    }

    if (deletedIds.length > 0) {
      await prisma.file.deleteMany({
        where: { id: { in: deletedIds }, userId: user.id }
      })
    }

    for (const accountId of syncedAccountIds) {
      const account = files.find((file) => file.connectedAccountId === accountId)?.connectedAccount
      if (account?.provider === 's3') {
        await syncS3Quota(accountId).catch(() => undefined)
      } else {
        await syncGoogleQuota(accountId).catch(() => undefined)
      }
    }

    if (deletedIds.length === 0 && failed.length > 0) {
      return NextResponse.json({ code: 'FILES_DELETE_FAILED', message: 'No files were permanently deleted.', deleted: 0, failed }, { status: 400 })
    }
    return NextResponse.json({ status: 'ok', deleted: deletedIds.length, failed })
  } catch (error) {
    return handleRouteError(error)
  }
}
