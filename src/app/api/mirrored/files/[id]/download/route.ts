import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { streamGoogleFile } from '@/lib/stream-file'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const { id } = await params
    const file = await prisma.mirroredFile.findFirst({
      where: { id, userId: user.id, status: 'active', connectedAccount: { status: 'connected' } },
      include: { connectedAccount: true },
    })
    if (!file) return apiError(404, 'NOT_FOUND', 'Shared file not found.')
    return streamGoogleFile(file, request.headers.get('range') ?? undefined, { disposition: 'attachment' })
  } catch (error) {
    return handleRouteError(error)
  }
}
