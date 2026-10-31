import { apiError } from '@/lib/http'
import { streamProviderFile } from '@/lib/stream-file'
import { findSharedFile } from '../route'

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const file = await findSharedFile(token)
  if (!file) return apiError(404, 'SHARE_NOT_FOUND', 'Shared file not found.')
  return streamProviderFile(file, request.headers.get('range') ?? undefined, { disposition: 'attachment' })
}
