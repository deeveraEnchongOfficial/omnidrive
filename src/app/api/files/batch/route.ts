import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { createAuditLog } from '@/lib/audit'

const batchFileSchema = z.object({ fileIds: z.array(z.string().min(1)).min(1).max(100) })

export async function PATCH(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = batchFileSchema.extend({ folderId: z.string().nullable().optional() }).parse(await request.json())
    if (body.folderId) await prisma.folder.findFirstOrThrow({ where: { id: body.folderId, userId: user.id, deletedAt: null } })
    const result = await prisma.file.updateMany({ where: { id: { in: body.fileIds }, userId: user.id, status: 'active' }, data: { folderId: body.folderId ?? null } })
    await createAuditLog({ userId: user.id, action: 'MOVE_FILES', entityType: 'file', metadata: { count: result.count, folderId: body.folderId } })
    return NextResponse.json({ status: 'ok', moved: result.count })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = batchFileSchema.parse(await request.json())
    const files = await prisma.file.findMany({ where: { id: { in: body.fileIds }, userId: user.id, status: 'active' } })
    const result = await prisma.file.updateMany({
      where: { id: { in: body.fileIds }, userId: user.id, status: 'active' },
      data: { status: 'deleted', deletedAt: new Date() }
    })
    for (const f of files) {
      await createAuditLog({ userId: user.id, action: 'TRASH_FILE', entityType: 'file', entityId: f.id, metadata: { name: f.name } })
    }
    return NextResponse.json({ status: 'ok', deleted: result.count })
  } catch (error) {
    return handleRouteError(error)
  }
}
