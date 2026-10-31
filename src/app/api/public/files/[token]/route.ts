import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError } from '@/lib/http'
import { hashToken } from '@/lib/crypto'
import type { ConnectedAccount, File } from '@prisma/client'

export type FileWithAccount = File & { connectedAccount: ConnectedAccount }

export async function findSharedFile(token: string): Promise<FileWithAccount | null> {
  const share = await prisma.fileShare.findFirst({
    where: { enabled: true, AND: [{ OR: [{ token }, { tokenHash: hashToken(token) }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }] },
    include: { file: { include: { connectedAccount: true } } },
  })
  if (!share || share.file.status !== 'active') return null
  return share.file
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const file = await findSharedFile(token)
  if (!file) return apiError(404, 'SHARE_NOT_FOUND', 'Shared file not found.')
  return NextResponse.json({ file: { id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes.toString(), createdAt: file.createdAt } })
}
