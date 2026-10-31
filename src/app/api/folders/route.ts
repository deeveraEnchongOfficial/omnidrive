import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { ensureGoogleAppFolder, getAuthedGoogleClient } from '@/lib/google'
import { createAuditLog } from '@/lib/audit'

const defaultFolderColor = '#3b82f6'
const defaultFolderIconUrl = 'https://api.iconify.design/lucide:folder.svg'
const iconUrlSchema = z.string().url().startsWith('https://api.iconify.design/lucide:').max(2048)
const colorSchema = z.string().regex(/^(#[0-9a-fA-F]{6}|text-[a-z]+-[0-9]+)$/).max(64)

const createSchema = z.object({
  name: z.string().min(1).max(255),
  color: colorSchema.optional(),
  iconUrl: iconUrlSchema.nullable().optional(),
  parentId: z.string().nullable().optional(),
})

function serializeFolder(folder: { id: string; name: string; color: string; iconUrl?: string | null; parentId?: string | null; providerFolderId?: string | null; createdAt: Date; updatedAt: Date }) {
  return { ...folder, providerFolderId: folder.providerFolderId ?? null, createdAt: folder.createdAt.toISOString(), updatedAt: folder.updatedAt.toISOString() }
}

async function ensureProviderFolderIds(
  folders: Array<{ id: string; name: string; parentId: string | null; providerFolderId: string | null }>,
  userId: string
) {
  const foldersWithoutId = folders.filter((f) => !f.providerFolderId)
  if (foldersWithoutId.length === 0) return

  const connectedAccount = await prisma.connectedAccount.findFirst({
    where: { userId, provider: 'google_drive', status: 'connected' }
  })
  if (!connectedAccount) return

  try {
    const auth = await getAuthedGoogleClient(connectedAccount)
    const drive = google.drive({ version: 'v3', auth })
    const appFolderId = await ensureGoogleAppFolder(connectedAccount)

    for (const folder of foldersWithoutId) {
      try {
        let parentGoogleId = appFolderId
        if (folder.parentId) {
          const parentFolder = await prisma.folder.findFirst({
            where: { id: folder.parentId, userId }
          })
          if (parentFolder?.providerFolderId) {
            parentGoogleId = parentFolder.providerFolderId
          }
        }

        const driveFolder = await drive.files.create({
          requestBody: {
            name: folder.name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentGoogleId]
          },
          fields: 'id'
        })

        const gId = driveFolder.data.id ?? null
        if (gId) {
          await prisma.folder.update({
            where: { id: folder.id },
            data: { providerFolderId: gId, connectedAccountId: connectedAccount.id }
          })
          folder.providerFolderId = gId
        }
      } catch (error) {
        console.error(`Failed self-healing for folder ${folder.id}:`, error)
      }
    }
  } catch (error) {
    console.error('Failed self-healing Google Drive auth:', error)
  }
}

export async function GET(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { searchParams } = new URL(request.url)
    const query = z.object({ parentId: z.string().nullable().optional(), all: z.string().optional() }).parse(Object.fromEntries(searchParams))
    const folders = await prisma.folder.findMany({
      where: { userId: user.id, deletedAt: null, ...(query.all === '1' ? {} : query.parentId ? { parentId: query.parentId } : { parent: null }) },
      select: { id: true, name: true, color: true, iconUrl: true, parentId: true, providerFolderId: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    await ensureProviderFolderIds(folders, user.id)
    return NextResponse.json({ folders: folders.map(serializeFolder) })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = createSchema.parse(await request.json())
    let parentFolder = null
    if (body.parentId) {
      parentFolder = await prisma.folder.findFirstOrThrow({
        where: { id: body.parentId, userId: user.id, deletedAt: null }
      })
    }

    const connectedAccount = await prisma.connectedAccount.findFirst({
      where: { userId: user.id, provider: 'google_drive', status: 'connected' }
    })

    let providerFolderId: string | null = null
    if (connectedAccount) {
      try {
        const auth = await getAuthedGoogleClient(connectedAccount)
        const drive = google.drive({ version: 'v3', auth })

        let googleParentId = await ensureGoogleAppFolder(connectedAccount)
        if (parentFolder && parentFolder.providerFolderId) {
          googleParentId = parentFolder.providerFolderId
        }

        const driveFolder = await drive.files.create({
          requestBody: {
            name: body.name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [googleParentId]
          },
          fields: 'id'
        })
        providerFolderId = driveFolder.data.id ?? null
      } catch (error) {
        console.error('Failed to create folder on Google Drive:', error)
      }
    }

    const folder = await prisma.folder.create({
      data: {
        userId: user.id,
        name: body.name,
        color: body.color ?? defaultFolderColor,
        iconUrl: body.iconUrl ?? defaultFolderIconUrl,
        parentId: body.parentId ?? null,
        providerFolderId,
        connectedAccountId: connectedAccount?.id ?? null
      },
      select: { id: true, name: true, color: true, iconUrl: true, parentId: true, providerFolderId: true, createdAt: true, updatedAt: true },
    })
    await createAuditLog({ userId: user.id, action: 'CREATE_FOLDER', entityType: 'folder', entityId: folder.id, metadata: { name: folder.name } })
    return NextResponse.json({ folder: serializeFolder(folder) }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
