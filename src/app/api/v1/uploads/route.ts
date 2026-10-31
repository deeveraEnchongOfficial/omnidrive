import { requireApiKey } from '@/lib/api-key'
import { handleRouteError } from '@/lib/http'
import { handleUpload } from '@/lib/upload'

export async function POST(request: Request) {
  try {
    const result = await requireApiKey(request, 'files:upload')
    if (result instanceof Response) return result
    return await handleUpload(request, { id: result.userId, sessionId: `api-key:${result.apiKeyId}` })
  } catch (error) {
    return handleRouteError(error)
  }
}
