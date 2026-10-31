export const GOOGLE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

export const GOOGLE_DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder'

export function isDriveFolder(mimeType: string | null | undefined): boolean {
  return mimeType === GOOGLE_DRIVE_FOLDER_MIME
}

export const GOOGLE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/drive.file',
  GOOGLE_READONLY_SCOPE,
]

export function scopeListHasReadonly(scopes: unknown): boolean {
  return Array.isArray(scopes) && scopes.includes(GOOGLE_READONLY_SCOPE)
}

export function mergeRequiredScopes(requested: unknown): string[] {
  const requestedScopes = Array.isArray(requested) ? requested.filter((s): s is string => typeof s === 'string') : []
  return Array.from(new Set([...requestedScopes, ...GOOGLE_SCOPES]))
}

export function grantedScopes(tokenScope: string | null | undefined, fallback: unknown): string[] {
  const granted = tokenScope?.split(' ').filter(Boolean) ?? []
  return granted.length > 0 ? granted : mergeRequiredScopes(fallback)
}

export type DriveMirroredFile = {
  id?: string | null
  name?: string | null
  mimeType?: string | null
  size?: string | null
  owners?: { displayName?: string | null; emailAddress?: string | null }[] | null
  webViewLink?: string | null
  createdTime?: string | null
  sharedWithMeTime?: string | null
}

export type MirroredFileData = {
  providerFileId: string
  name: string
  mimeType: string
  sizeBytes: bigint
  ownerName: string | null
  ownerEmail: string | null
  webViewLink: string | null
  sharedAt: Date | null
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export type SerializedMirroredFile = {
  id: string
  name: string
  mimeType: string
  sizeBytes: string
  ownerName: string | null
  ownerEmail: string | null
  webViewLink: string | null
  sharedAt: string | null
  accountEmail: string | null
}

type MirroredFileRow = {
  id: string
  name: string
  mimeType: string
  sizeBytes: bigint
  ownerName: string | null
  ownerEmail: string | null
  webViewLink: string | null
  sharedAt: Date | null
  connectedAccount?: { email: string } | null
}

export function serializeMirroredFile(row: MirroredFileRow): SerializedMirroredFile {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes.toString(),
    ownerName: row.ownerName,
    ownerEmail: row.ownerEmail,
    webViewLink: row.webViewLink,
    sharedAt: row.sharedAt?.toISOString() ?? null,
    accountEmail: row.connectedAccount?.email ?? null,
  }
}

export function accountNeedsReconnect(account: { provider: string; status: string; scopes: unknown }): boolean {
  return account.provider === 'google_drive' && account.status === 'connected' && !scopeListHasReadonly(account.scopes)
}

export function emailsNeedingReconnect(accounts: { provider: string; status: string; scopes: unknown; email: string }[]): string[] {
  return accounts.filter(accountNeedsReconnect).map((account) => account.email)
}

export function toMirroredFileData(driveFile: DriveMirroredFile): MirroredFileData | null {
  if (!driveFile.id || !driveFile.name || !driveFile.mimeType) return null
  const owner = driveFile.owners?.[0]
  return {
    providerFileId: driveFile.id,
    name: driveFile.name,
    mimeType: driveFile.mimeType,
    sizeBytes: driveFile.size && /^\d+$/.test(driveFile.size) ? BigInt(driveFile.size) : 0n,
    ownerName: owner?.displayName ?? null,
    ownerEmail: owner?.emailAddress ?? null,
    webViewLink: driveFile.webViewLink ?? null,
    sharedAt: toDate(driveFile.sharedWithMeTime) ?? toDate(driveFile.createdTime),
  }
}
