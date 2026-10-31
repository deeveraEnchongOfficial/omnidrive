import { prisma } from '@/lib/prisma'
import { apiError } from '@/lib/http'
import { hashToken } from '@/lib/crypto'
import { streamProviderFile } from '@/lib/stream-file'

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const preview = await prisma.filePreviewToken.findFirst({
    where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() } },
    include: { file: { include: { connectedAccount: true } } },
  })
  if (!preview || preview.file.status !== 'active') {
    return apiError(404, 'PREVIEW_NOT_FOUND', 'Preview token not found.')
  }
  return streamProviderFile(preview.file, request.headers.get('range') ?? undefined, { disposition: 'inline' })
}
