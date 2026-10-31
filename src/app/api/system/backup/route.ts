import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'

// MongoDB port: the original exported the SQLite DB file. Atlas is managed,
// so backup exports every user-owned collection as a JSON document instead.

const bigintFields = new Set(['sizeBytes', 'totalBytes', 'usedBytes', 'availableBytes', 'trashBytes', 'quotaBytes'])

function serializeDoc(doc: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value === 'bigint') out[key] = { $bigint: value.toString() }
    else if (value instanceof Date) out[key] = { $date: value.toISOString() }
    else out[key] = value
  }
  return out
}

export async function GET() {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const userId = user.id

    const [userRow, folders, files, fileShares, filePreviewTokens, connectedAccounts, storageAccounts, s3StorageConfigs, uploadSessions, workspaceInvites, auditLogs, apiKeys, uploadRoutingPolicy, providerConfigs] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.folder.findMany({ where: { userId } }),
      prisma.file.findMany({ where: { userId } }),
      prisma.fileShare.findMany({ where: { userId } }),
      prisma.filePreviewToken.findMany({ where: { userId } }),
      prisma.connectedAccount.findMany({ where: { userId } }),
      prisma.storageAccount.findMany({ where: { connectedAccount: { userId } } }),
      prisma.s3StorageConfig.findMany({ where: { userId } }),
      prisma.uploadSession.findMany({ where: { userId } }),
      prisma.workspaceInvite.findMany({ where: { inviterId: userId } }),
      prisma.auditLog.findMany({ where: { userId } }),
      prisma.apiKey.findMany({ where: { userId } }),
      prisma.uploadRoutingPolicy.findUnique({ where: { userId } }),
      prisma.providerConfig.findMany({ where: { userId } }),
    ])

    const collections = {
      user: userRow ? [userRow] : [],
      folders, files, fileShares, filePreviewTokens, connectedAccounts, storageAccounts,
      s3StorageConfigs, uploadSessions, workspaceInvites, auditLogs, apiKeys,
      uploadRoutingPolicies: uploadRoutingPolicy ? [uploadRoutingPolicy] : [],
      providerConfigs,
    }

    const payload = {
      format: 'omnidrive-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      userId,
      collections: Object.fromEntries(
        Object.entries(collections).map(([name, docs]) => [name, (docs as unknown[]).map((d) => serializeDoc(d as Record<string, unknown>))])
      ),
    }

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="omnidrive-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
