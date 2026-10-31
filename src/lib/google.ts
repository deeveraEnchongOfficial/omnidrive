import { google } from 'googleapis'
import type { ConnectedAccount, ProviderConfig } from '@prisma/client'
import { prisma } from './prisma'
import { decryptText, encryptText } from './crypto'
import { scopeListHasReadonly, toMirroredFileData, type MirroredFileData } from './shared-files'

const googleDriveFolderMimeType = 'application/vnd.google-apps.folder'
const appFolderName = 'omnidrive'

export { GOOGLE_SCOPES } from './shared-files'

export function createOAuthClient(config: ProviderConfig) {
  return new google.auth.OAuth2(decryptText(config.clientIdEncrypted), decryptText(config.clientSecretEncrypted), config.redirectUri)
}

export async function getGlobalGoogleConfig() {
  return prisma.providerConfig.findFirstOrThrow({
    where: { user: null, provider: 'google_drive', status: 'active' },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getAuthedGoogleClient(account: ConnectedAccount) {
  if (!account.accessTokenEncrypted || !account.refreshTokenEncrypted || !account.tokenExpiresAt) throw new Error('Google account tokens are missing.')
  const config = account.providerConfigId
    ? await prisma.providerConfig.findUniqueOrThrow({ where: { id: account.providerConfigId } })
    : await getGlobalGoogleConfig()
  if (!account.providerConfigId) {
    await prisma.connectedAccount.update({ where: { id: account.id }, data: { providerConfigId: config.id } }).catch(() => undefined)
  }
  const client = createOAuthClient(config)
  client.setCredentials({
    access_token: decryptText(account.accessTokenEncrypted),
    refresh_token: decryptText(account.refreshTokenEncrypted),
    expiry_date: account.tokenExpiresAt.getTime(),
  })

  if (account.tokenExpiresAt.getTime() < Date.now() + 60_000) {
    const result = await client.refreshAccessToken()
    const credentials = result.credentials
    if (credentials.access_token) {
      await prisma.connectedAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEncrypted: encryptText(credentials.access_token),
          tokenExpiresAt: new Date(credentials.expiry_date ?? Date.now() + 3600_000),
        },
      })
      client.setCredentials(credentials)
    }
  }

  return client
}

export async function syncGoogleQuota(accountId: string) {
  const account = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: accountId } })
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const about = await drive.about.get({ fields: 'storageQuota,user' })
  const quota = about.data.storageQuota
  const total = quota?.limit ? BigInt(quota.limit) : null
  const used = quota?.usage ? BigInt(quota.usage) : 0n
  return prisma.storageAccount.upsert({
    where: { connectedAccountId: accountId },
    create: {
      connectedAccountId: accountId,
      totalBytes: total,
      usedBytes: used,
      availableBytes: total === null ? null : total - used,
      trashBytes: quota?.usageInDriveTrash ? BigInt(quota.usageInDriveTrash) : null,
      lastSyncedAt: new Date(),
    },
    update: {
      totalBytes: total,
      usedBytes: used,
      availableBytes: total === null ? null : total - used,
      trashBytes: quota?.usageInDriveTrash ? BigInt(quota.usageInDriveTrash) : null,
      lastSyncedAt: new Date(),
    },
  })
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export async function ensureGoogleAppFolder(account: ConnectedAccount) {
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const queryName = escapeDriveQueryValue(appFolderName)
  const existing = await drive.files.list({
    q: `name = '${queryName}' and mimeType = '${googleDriveFolderMimeType}' and 'root' in parents and trashed = false`,
    spaces: 'drive',
    fields: 'files(id,name)',
    pageSize: 1,
  })
  const folderId = existing.data.files?.[0]?.id ?? (await drive.files.create({
    requestBody: { name: appFolderName, mimeType: googleDriveFolderMimeType, parents: ['root'] },
    fields: 'id',
  })).data.id

  if (!folderId) throw new Error('Failed to create Google Drive app folder.')
  return folderId
}

export type GoogleAppFolderSyncResult = {
  accountId: string
  created: number
  updated: number
  deleted: number
}

type DriveFileMetadata = {
  id: string
  name: string
  mimeType: string
  sizeBytes: bigint
  parentId: string
}

export async function syncGoogleAppFolderFiles(accountId: string, userId: string): Promise<GoogleAppFolderSyncResult> {
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId, provider: 'google_drive', status: 'connected' } })
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const appFolderId = await ensureGoogleAppFolder(account)

  const userFolders = await prisma.folder.findMany({
    where: { userId, connectedAccountId: account.id, deletedAt: null },
    select: { id: true, providerFolderId: true }
  })
  const parentIds = [
    appFolderId,
    ...userFolders.map((f) => f.providerFolderId).filter((id): id is string => !!id)
  ]

  const driveFiles: DriveFileMetadata[] = []
  let pageToken: string | undefined

  const parentsQuery = parentIds.map((id) => `'${id}' in parents`).join(' or ')
  const q = `(${parentsQuery}) and mimeType != '${googleDriveFolderMimeType}' and trashed = false`

  do {
    const response = await drive.files.list({
      q,
      spaces: 'drive',
      fields: 'nextPageToken,files(id,name,mimeType,size,parents)',
      pageSize: 1000,
      pageToken,
    })
    for (const file of response.data.files ?? []) {
      if (!file.id || !file.name || !file.mimeType) continue
      const parentId = file.parents?.[0] ?? appFolderId
      driveFiles.push({ id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: BigInt(file.size ?? 0), parentId })
    }
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  const existingFiles = await prisma.file.findMany({ where: { userId, connectedAccountId: account.id, provider: 'google_drive' } })
  const existingByProviderId = new Map(existingFiles.map((file) => [file.providerFileId, file]))
  const driveFileIds = new Set(driveFiles.map((file) => file.id))
  let created = 0
  let updated = 0
  let deleted = 0

  const folderIdMap = new Map(userFolders.map((f) => [f.providerFolderId, f.id]))

  for (const driveFile of driveFiles) {
    const dbFolderId = driveFile.parentId === appFolderId ? null : (folderIdMap.get(driveFile.parentId) ?? null)
    const existing = existingByProviderId.get(driveFile.id)
    if (!existing) {
      await prisma.file.create({
        data: { userId, connectedAccountId: account.id, provider: 'google_drive', providerFileId: driveFile.id, name: driveFile.name, mimeType: driveFile.mimeType, sizeBytes: driveFile.sizeBytes, status: 'active', folderId: dbFolderId },
      })
      created += 1
      continue
    }

    const needsUpdate = existing.name !== driveFile.name || existing.mimeType !== driveFile.mimeType || existing.sizeBytes !== driveFile.sizeBytes || existing.status !== 'active' || existing.deletedAt !== null || existing.folderId !== dbFolderId
    if (needsUpdate) {
      await prisma.file.update({
        where: { id: existing.id },
        data: { name: driveFile.name, mimeType: driveFile.mimeType, sizeBytes: driveFile.sizeBytes, status: 'active', deletedAt: null, folderId: dbFolderId },
      })
      updated += 1
    }
  }

  const missingActiveIds = existingFiles.filter((file) => file.status === 'active' && !driveFileIds.has(file.providerFileId)).map((file) => file.id)
  if (missingActiveIds.length > 0) {
    const result = await prisma.file.updateMany({ where: { id: { in: missingActiveIds }, userId }, data: { status: 'deleted', deletedAt: new Date() } })
    deleted = result.count
  }

  await syncGoogleQuota(account.id).catch(() => undefined)
  return { accountId: account.id, created, updated, deleted }
}

export type SharedSyncResult = {
  accountId: string
  created: number
  updated: number
  deleted: number
  skipped?: 'scope'
  error?: string
}

type MirrorFlag = 'sharedWithMe' | 'starred'

async function syncMirroredDriveFiles(accountId: string, userId: string, q: string, flag: MirrorFlag): Promise<SharedSyncResult> {
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId, provider: 'google_drive', status: 'connected' } })
  if (!scopeListHasReadonly(account.scopes)) {
    return { accountId: account.id, created: 0, updated: 0, deleted: 0, skipped: 'scope' }
  }

  const mirrored: MirroredFileData[] = []
  let pageToken: string | undefined

  try {
    const auth = await getAuthedGoogleClient(account)
    const drive = google.drive({ version: 'v3', auth })
    do {
      const response = await drive.files.list({
        q,
        spaces: 'drive',
        fields: 'nextPageToken,files(id,name,mimeType,size,owners(displayName,emailAddress),webViewLink,createdTime,sharedWithMeTime)',
        pageSize: 1000,
        pageToken,
      })
      for (const file of response.data.files ?? []) {
        const data = toMirroredFileData(file)
        if (data) mirrored.push(data)
      }
      pageToken = response.data.nextPageToken ?? undefined
    } while (pageToken)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.connectedAccount.update({ where: { id: account.id }, data: { lastError: message } }).catch(() => undefined)
    throw error
  }

  const existingFiles = await prisma.mirroredFile.findMany({ where: { connectedAccountId: account.id } })
  const existingByProviderId = new Map(existingFiles.map((file) => [file.providerFileId, file]))
  const driveFileIds = new Set(mirrored.map((file) => file.providerFileId))
  let created = 0
  let updated = 0
  let deleted = 0

  for (const data of mirrored) {
    const existing = existingByProviderId.get(data.providerFileId)
    if (!existing) {
      await prisma.mirroredFile.create({
        data: { userId, connectedAccountId: account.id, provider: 'google_drive', status: 'active', sharedWithMe: flag === 'sharedWithMe', starred: flag === 'starred', ...data },
      })
      created += 1
      continue
    }

    const needsUpdate = existing.name !== data.name || existing.mimeType !== data.mimeType || existing.sizeBytes !== data.sizeBytes || existing.ownerName !== data.ownerName || existing.ownerEmail !== data.ownerEmail || existing.webViewLink !== data.webViewLink || existing.sharedAt?.getTime() !== data.sharedAt?.getTime() || existing.status !== 'active' || existing.deletedAt !== null || !existing[flag]
    if (needsUpdate) {
      await prisma.mirroredFile.update({
        where: { id: existing.id },
        data: { ...data, [flag]: true, status: 'active', deletedAt: null },
      })
      updated += 1
    }
  }

  const missingIds = existingFiles.filter((file) => file.status === 'active' && file[flag] && !driveFileIds.has(file.providerFileId)).map((file) => file.id)
  if (missingIds.length > 0) {
    await prisma.mirroredFile.updateMany({ where: { id: { in: missingIds } }, data: { [flag]: false } })
    const result = await prisma.mirroredFile.updateMany({ where: { id: { in: missingIds }, sharedWithMe: false, starred: false }, data: { status: 'deleted', deletedAt: new Date() } })
    updated += missingIds.length - result.count
    deleted = result.count
  }

  return { accountId: account.id, created, updated, deleted }
}

export function syncGoogleSharedFiles(accountId: string, userId: string): Promise<SharedSyncResult> {
  return syncMirroredDriveFiles(accountId, userId, `sharedWithMe and trashed = false and mimeType != '${googleDriveFolderMimeType}'`, 'sharedWithMe')
}

export function syncGoogleStarredFiles(accountId: string, userId: string): Promise<SharedSyncResult> {
  return syncMirroredDriveFiles(accountId, userId, `starred = true and trashed = false`, 'starred')
}

export type GoogleProfile = {
  id: string
  email: string
  name?: string | null
  picture?: string | null
}

export type GoogleTokens = {
  access_token: string
  refresh_token?: string | null
  expiry_date?: number | null
}

export async function connectGoogleDriveAccount(input: {
  userId: string
  providerConfigId: string | null
  profile: GoogleProfile
  tokens: GoogleTokens
  scopes: string[]
}) {
  const { userId, providerConfigId, profile, tokens, scopes } = input
  const existing = await prisma.connectedAccount.findUnique({
    where: { userId_provider_providerAccountId: { userId, provider: 'google_drive', providerAccountId: profile.id } },
  })
  const refreshTokenEncrypted = tokens.refresh_token ? encryptText(tokens.refresh_token) : existing?.refreshTokenEncrypted
  if (!refreshTokenEncrypted) throw new Error('Google did not return a refresh token.')

  const tokenData = {
    providerConfigId,
    email: profile.email,
    displayName: profile.name,
    avatarUrl: profile.picture,
    accessTokenEncrypted: encryptText(tokens.access_token),
    refreshTokenEncrypted,
    tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
    scopes,
    status: 'connected',
    lastError: null,
  }

  const account = await prisma.connectedAccount.upsert({
    where: { userId_provider_providerAccountId: { userId, provider: 'google_drive', providerAccountId: profile.id } },
    create: {
      userId,
      provider: 'google_drive',
      providerAccountId: profile.id,
      ...tokenData,
    },
    update: tokenData,
  })
  return account
}
