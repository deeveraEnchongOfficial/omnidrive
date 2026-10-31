import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'

// Restores a backup produced by /api/system/backup. Replaces the current
// user's rows with the backup's rows, per collection.

const dateFields = new Set([
  'createdAt', 'updatedAt', 'deletedAt', 'expiresAt', 'revokedAt', 'lastUsedAt',
  'lastSyncedAt', 'completedAt', 'acceptedAt', 'usedAt', 'tokenExpiresAt', 'starredAt',
])
const bigintFields = new Set(['sizeBytes', 'totalBytes', 'usedBytes', 'availableBytes', 'trashBytes', 'quotaBytes'])

function deserializeDoc(doc: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    if (value && typeof value === 'object' && '$bigint' in (value as Record<string, unknown>)) out[key] = BigInt((value as { $bigint: string }).$bigint)
    else if (value && typeof value === 'object' && '$date' in (value as Record<string, unknown>)) out[key] = new Date((value as { $date: string }).$date)
    else if (value === null) out[key] = null
    else if (dateFields.has(key) && typeof value === 'string') out[key] = new Date(value)
    else if (bigintFields.has(key) && (typeof value === 'string' || typeof value === 'number')) out[key] = BigInt(value)
    else out[key] = value
  }
  return out
}

type Payload = {
  format?: string
  collections?: Record<string, Array<Record<string, unknown>>>
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')

    const payload = (await request.json()) as Payload
    if (payload.format !== 'omnidrive-backup' || !payload.collections) {
      return apiError(400, 'BAD_BACKUP', 'Not an OmniDrive backup file.')
    }
    const c = payload.collections
    const userId = user.id
    const own = (docs: Array<Record<string, unknown>> | undefined, userKey: string) =>
      (docs ?? []).filter((d) => d[userKey] === userId || d.id === userId).map(deserializeDoc)

    // Children first, then parents, then rebuild in dependency order.
    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { userId } }),
      prisma.filePreviewToken.deleteMany({ where: { userId } }),
      prisma.fileShare.deleteMany({ where: { userId } }),
      prisma.uploadSession.deleteMany({ where: { userId } }),
      prisma.file.deleteMany({ where: { userId } }),
      prisma.folder.deleteMany({ where: { userId } }),
      prisma.storageAccount.deleteMany({ where: { connectedAccount: { userId } } }),
      prisma.s3StorageConfig.deleteMany({ where: { userId } }),
      prisma.connectedAccount.deleteMany({ where: { userId } }),
      prisma.workspaceInvite.deleteMany({ where: { inviterId: userId } }),
      prisma.apiKey.deleteMany({ where: { userId } }),
      prisma.uploadRoutingPolicy.deleteMany({ where: { userId } }),
      prisma.providerConfig.deleteMany({ where: { userId } }),
    ])

    const counts: Record<string, number> = {}
    const insert = async (name: string, docs: Array<Record<string, unknown>>, create: (data: unknown[]) => Promise<{ count: number }>) => {
      if (docs.length === 0) { counts[name] = 0; return }
      const result = await create(docs)
      counts[name] = result.count
    }

    await insert('providerConfigs', own(c.providerConfigs, 'userId'), (d) => prisma.providerConfig.createMany({ data: d as never[] }))
    await insert('connectedAccounts', own(c.connectedAccounts, 'userId'), (d) => prisma.connectedAccount.createMany({ data: d as never[] }))
    await insert('storageAccounts', (c.storageAccounts ?? []).map(deserializeDoc), (d) => prisma.storageAccount.createMany({ data: d as never[] }))
    await insert('s3StorageConfigs', own(c.s3StorageConfigs, 'userId'), (d) => prisma.s3StorageConfig.createMany({ data: d as never[] }))
    await insert('folders', own(c.folders, 'userId'), (d) => prisma.folder.createMany({ data: d as never[] }))
    await insert('files', own(c.files, 'userId'), (d) => prisma.file.createMany({ data: d as never[] }))
    await insert('fileShares', own(c.fileShares, 'userId'), (d) => prisma.fileShare.createMany({ data: d as never[] }))
    await insert('filePreviewTokens', own(c.filePreviewTokens, 'userId'), (d) => prisma.filePreviewToken.createMany({ data: d as never[] }))
    await insert('uploadSessions', own(c.uploadSessions, 'userId'), (d) => prisma.uploadSession.createMany({ data: d as never[] }))
    await insert('workspaceInvites', own(c.workspaceInvites, 'inviterId'), (d) => prisma.workspaceInvite.createMany({ data: d as never[] }))
    await insert('auditLogs', own(c.auditLogs, 'userId'), (d) => prisma.auditLog.createMany({ data: d as never[] }))
    await insert('apiKeys', own(c.apiKeys, 'userId'), (d) => prisma.apiKey.createMany({ data: d as never[] }))
    await insert('uploadRoutingPolicies', own(c.uploadRoutingPolicies, 'userId'), (d) => prisma.uploadRoutingPolicy.createMany({ data: d as never[] }))

    return NextResponse.json({ status: 'success', restored: counts })
  } catch (error) {
    return handleRouteError(error)
  }
}
