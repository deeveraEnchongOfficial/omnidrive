import { getAuthUser } from '@/lib/auth'
import { apiError, handleRouteError } from '@/lib/http'
import { handleUpload } from '@/lib/upload'

export async function POST(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    return await handleUpload(request, user)
  } catch (error) {
    return handleRouteError(error)
  }
}
