import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number | bigint | string | null | undefined) {
  if (bytes === null || bytes === undefined) return '—'
  const n = typeof bytes === 'bigint' ? Number(bytes) : typeof bytes === 'string' ? Number(bytes) : bytes
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log2(Math.abs(n)) / 10), units.length - 1)
  return `${(n / 2 ** (10 * i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
}
