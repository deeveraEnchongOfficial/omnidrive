import { prisma } from './prisma'

export async function createAuditLog(input: {
  userId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata as object | undefined,
      },
    })
  } catch (error) {
    console.error('[audit] failed to write log:', error)
  }
}
