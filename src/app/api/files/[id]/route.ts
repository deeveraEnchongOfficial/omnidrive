import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { getAuthedGoogleClient } from '@/lib/google'
import { createAuditLog } from '@/lib/audit'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id } = await params
    const file = await prisma.file.findFirstOrThrow({ where: { id, userId: user.id }, include: { connectedAccount: { select: { id: true, email: true, provider: true } }, folder: { select: { id: true, name: true } } } })
    return NextResponse.json({ file: { ...file, sizeBytes: file.sizeBytes.toString() } })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id } = await params
    const body = z.object({
      name: z.string().min(1).max(255).optional(),
      folderId: z.string().nullable().optional(),
      starred: z.boolean().optional(),
      status: z.enum(['active', 'archived']).optional(),
    }).parse(await request.json())
    const file = await prisma.file.findFirstOrThrow({ where: { id, userId: user.id }, include: { connectedAccount: true } })
    const drive = file.provider === 's3' ? null : google.drive({ version: 'v3', auth: await getAuthedGoogleClient(file.connectedAccount) })
    if (body.folderId) await prisma.folder.findFirstOrThrow({ where: { id: body.folderId, userId: user.id, deletedAt: null } })
    if (body.name && drive) await drive.files.update({ fileId: file.providerFileId, requestBody: { name: body.name } })
    const updated = await prisma.file.update({
      where: { id: file.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
        ...(body.starred !== undefined ? { starredAt: body.starred ? new Date() : null } : {}),
        ...(body.status !== undefined ? { status: body.status, deletedAt: body.status === 'archived' ? new Date() : null } : {}),
      },
      include: { connectedAccount: { select: { id: true, email: true, provider: true } }, folder: { select: { id: true, name: true } } }
    })
    await createAuditLog({ userId: user.id, action: 'UPDATE_FILE', entityType: 'file', entityId: updated.id, metadata: { name: updated.name, updates: body } })
    return NextResponse.json({ file: { ...updated, sizeBytes: updated.sizeBytes.toString() } })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id } = await params
    const file = await prisma.file.findFirstOrThrow({ where: { id, userId: user.id, status: 'active' } })
    await prisma.file.update({ where: { id: file.id }, data: { status: 'deleted', deletedAt: new Date() } })
    await createAuditLog({ userId: user.id, action: 'TRASH_FILE', entityType: 'file', entityId: file.id, metadata: { name: file.name } })
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    return handleRouteError(error)
  }
}
