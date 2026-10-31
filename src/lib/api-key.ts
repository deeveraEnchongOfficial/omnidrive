import { prisma } from './prisma'
import { hashToken } from './crypto'
import { apiError } from './http'

export type ApiKeyAuth = { userId: string; apiKeyId: string; scopes: string[] }

export async function requireApiKey(request: Request, scope: string): Promise<ApiKeyAuth | Response> {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return apiError(401, 'API_KEY_REQUIRED', 'API key required.')
  const rawKey = header.slice(7).trim()
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hashToken(rawKey) } })
  if (!apiKey || apiKey.status !== 'active' || apiKey.revokedAt || (apiKey.expiresAt && apiKey.expiresAt <= new Date())) {
    return apiError(401, 'API_KEY_INVALID', 'Invalid API key.')
  }
  const scopes = Array.isArray(apiKey.scopes) ? apiKey.scopes.filter((s): s is string => typeof s === 'string') : []
  if (!scopes.includes(scope)) return apiError(403, 'API_KEY_FORBIDDEN', 'API key does not have required scope.')
  await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined)
  return { userId: apiKey.userId, apiKeyId: apiKey.id, scopes }
}
