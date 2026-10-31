import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { createAuditLog } from '@/lib/audit'

export async function POST(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = z.object({ fileIds: z.array(z.string().min(1)).min(1).max(100) }).parse(await request.json())
    const files = await prisma.file.findMany({ where: { id: { in: body.fileIds }, userId: user.id, status: 'deleted' } })
    const result = await prisma.file.updateMany({
      where: { id: { in: body.fileIds }, userId: user.id, status: 'deleted' },
      data: { status: 'active', deletedAt: null }
    })
    for (const f of files) {
      await createAuditLog({ userId: user.id, action: 'RESTORE_FILE', entityType: 'file', entityId: f.id, metadata: { name: f.name } })
    }
    return NextResponse.json({ status: 'ok', restored: result.count })
  } catch (error) {
    return handleRouteError(error)
  }
}
