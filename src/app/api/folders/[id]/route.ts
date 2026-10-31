import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { ensureGoogleAppFolder, getAuthedGoogleClient, syncGoogleQuota } from '@/lib/google'
import { createAuditLog } from '@/lib/audit'

const iconUrlSchema = z.string().url().startsWith('https://api.iconify.design/lucide:').max(2048)
const colorSchema = z.string().regex(/^(#[0-9a-fA-F]{6}|text-[a-z]+-[0-9]+)$/).max(64)
const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  color: colorSchema.optional(),
  iconUrl: iconUrlSchema.nullable().optional(),
  parentId: z.string().nullable().optional(),
}).partial()

function serializeFolder(folder: { id: string; name: string; color: string; iconUrl?: string | null; parentId?: string | null; providerFolderId?: string | null; createdAt: Date; updatedAt: Date }) {
  return { ...folder, providerFolderId: folder.providerFolderId ?? null, createdAt: folder.createdAt.toISOString(), updatedAt: folder.updatedAt.toISOString() }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id: folderId } = await params
    const body = patchSchema.parse(await request.json())
    if (body.parentId === folderId) return apiError(400, 'FOLDER_INVALID_PARENT', 'Folder cannot be moved into itself.')

    const folderRecord = await prisma.folder.findFirstOrThrow({
      where: { id: folderId, userId: user.id, deletedAt: null },
      include: { connectedAccount: true }
    })

    if (body.parentId) {
      await prisma.folder.findFirstOrThrow({ where: { id: body.parentId, userId: user.id, deletedAt: null } })
      const folders = await prisma.folder.findMany({ where: { userId: user.id, deletedAt: null }, select: { id: true, parentId: true } })
      const descendantIds = new Set<string>([folderId])
      let changed = true
      while (changed) {
        changed = false
        for (const folder of folders) {
          if (folder.parentId && descendantIds.has(folder.parentId) && !descendantIds.has(folder.id)) {
            descendantIds.add(folder.id)
            changed = true
          }
        }
      }
      if (descendantIds.has(body.parentId)) return apiError(400, 'FOLDER_INVALID_PARENT', 'Folder cannot be moved into itself or a child folder.')
    }

    if (body.name && folderRecord.providerFolderId && folderRecord.connectedAccount) {
      try {
        const auth = await getAuthedGoogleClient(folderRecord.connectedAccount)
        const drive = google.drive({ version: 'v3', auth })
        await drive.files.update({
          fileId: folderRecord.providerFolderId,
          requestBody: { name: body.name }
        })
      } catch (error) {
        console.error('Failed to rename folder on Google Drive:', error)
      }
    }

    if (body.parentId !== undefined && folderRecord.providerFolderId && folderRecord.connectedAccount) {
      try {
        const auth = await getAuthedGoogleClient(folderRecord.connectedAccount)
        const drive = google.drive({ version: 'v3', auth })

        let newGoogleParentId = await ensureGoogleAppFolder(folderRecord.connectedAccount)
        if (body.parentId) {
          const newParent = await prisma.folder.findFirst({ where: { id: body.parentId, userId: user.id } })
          if (newParent?.providerFolderId) {
            newGoogleParentId = newParent.providerFolderId
          }
        }

        const fileInfo = await drive.files.get({ fileId: folderRecord.providerFolderId, fields: 'parents' })
        const previousParents = fileInfo.data.parents?.join(',')

        await drive.files.update({
          fileId: folderRecord.providerFolderId,
          addParents: newGoogleParentId,
          removeParents: previousParents,
          fields: 'id, parents'
        })
      } catch (error) {
        console.error('Failed to move folder on Google Drive:', error)
      }
    }

    const folder = await prisma.folder.updateMany({
      where: { id: folderId, userId: user.id, deletedAt: null },
      data: { ...(body.name ? { name: body.name } : {}), ...(body.color ? { color: body.color } : {}), ...(body.iconUrl !== undefined ? { iconUrl: body.iconUrl } : {}), ...(body.parentId !== undefined ? { parentId: body.parentId } : {}) },
    })
    if (folder.count === 0) return apiError(404, 'FOLDER_NOT_FOUND', 'Folder not found.')
    const updated = await prisma.folder.findFirstOrThrow({
      where: { id: folderId, userId: user.id },
      select: { id: true, name: true, color: true, iconUrl: true, parentId: true, providerFolderId: true, createdAt: true, updatedAt: true },
    })
    await createAuditLog({ userId: user.id, action: 'UPDATE_FOLDER', entityType: 'folder', entityId: updated.id, metadata: { name: updated.name, updates: body } })
    return NextResponse.json({ folder: serializeFolder(updated) })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id: rootId } = await params
    const root = await prisma.folder.findFirstOrThrow({ where: { id: rootId, userId: user.id, deletedAt: null } })
    const folders = await prisma.folder.findMany({ where: { userId: user.id, deletedAt: null }, select: { id: true, parentId: true } })
    const folderIds = new Set<string>([root.id])
    let changed = true
    while (changed) {
      changed = false
      for (const folder of folders) {
        if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
          folderIds.add(folder.id)
          changed = true
        }
      }
    }

    const files = await prisma.file.findMany({ where: { userId: user.id, status: 'active', folderId: { in: [...folderIds] } }, include: { connectedAccount: true } })
    const syncedAccountIds = new Set<string>()
    for (const file of files) {
      try {
        if (file.provider === 's3') continue
        const auth = await getAuthedGoogleClient(file.connectedAccount)
        const drive = google.drive({ version: 'v3', auth })
        await drive.files.delete({ fileId: file.providerFileId })
        syncedAccountIds.add(file.connectedAccountId)
      } catch {
        // Keep going so one failure does not block the whole deletion
      }
    }

    const foldersToDelete = await prisma.folder.findMany({ where: { id: { in: [...folderIds] }, userId: user.id }, include: { connectedAccount: true } })
    for (const f of foldersToDelete) {
      if (f.providerFolderId && f.connectedAccount) {
        try {
          const auth = await getAuthedGoogleClient(f.connectedAccount)
          const drive = google.drive({ version: 'v3', auth })
          await drive.files.delete({ fileId: f.providerFolderId })
          if (f.connectedAccountId) syncedAccountIds.add(f.connectedAccountId)
        } catch {
          // ignore
        }
      }
    }

    await prisma.file.updateMany({ where: { id: { in: files.map((file) => file.id) } }, data: { status: 'deleted', deletedAt: new Date() } })
    await prisma.folder.updateMany({ where: { id: { in: [...folderIds] }, userId: user.id }, data: { deletedAt: new Date() } })
    for (const accountId of syncedAccountIds) await syncGoogleQuota(accountId).catch(() => undefined)

    await createAuditLog({ userId: user.id, action: 'DELETE_FOLDER', entityType: 'folder', entityId: root.id, metadata: { name: root.name } })
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    return handleRouteError(error)
  }
}
