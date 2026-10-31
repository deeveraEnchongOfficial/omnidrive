export const API_URL = '/api'

export class ApiError extends Error {
  code: string
  status: number
  constructor(status: number, code: string, message: string) {
    super(message)
    this.code = code
    this.status = status
  }
}

type ApiInit = RequestInit & { skipAuth?: boolean }

export async function apiFetch<T>(path: string, init?: ApiInit): Promise<T> {
  const { skipAuth: _skipAuth, ...rest } = init ?? {}
  const url = path.startsWith('http') || path.startsWith('/api/') ? path : `${API_URL}${path}`
  const res = await fetch(url, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(rest.headers ?? {}) },
  })
  if (!res.ok) {
    let code = 'REQUEST_FAILED'
    let message = `Request failed (${res.status})`
    try {
      const data = (await res.json()) as { code?: string; message?: string }
      code = data.code ?? code
      message = data.message ?? message
    } catch { /* non-JSON error body */ }
    if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login'
    }
    throw new ApiError(res.status, code, message)
  }
  return res.json() as Promise<T>
}

export function formatBytes(bytes: number | string | null | undefined) {
  if (bytes === null || bytes === undefined) return '—'
  const n = typeof bytes === 'string' ? Number(bytes) : bytes
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log2(Math.abs(n)) / 10), units.length - 1)
  return `${(n / 2 ** (10 * i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
