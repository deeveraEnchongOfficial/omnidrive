import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError } from '@/lib/http'
import { streamProviderFile } from '@/lib/stream-file'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser()
  if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
  const { id } = await params
  const file = await prisma.file.findFirstOrThrow({ where: { id, userId: user.id }, include: { connectedAccount: true } })
  return streamProviderFile(file, request.headers.get('range') ?? undefined, { disposition: 'attachment' })
}
