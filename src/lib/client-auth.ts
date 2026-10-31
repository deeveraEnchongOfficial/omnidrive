'use client'

import { signOut } from 'next-auth/react'

export type AuthUser = {
  id: string
  name: string
  email: string
  status?: string
}

const USER_KEY = 'omnidrive.user'

// Bearer tokens are gone with Auth.js cookie sessions; kept so ported call
// sites compile. Returns null — do not send an Authorization header.
export function getAccessToken() {
  return null
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null
  const raw = sessionStorage.getItem(USER_KEY)
  return raw ? JSON.parse(raw) as AuthUser : null
}

export function setStoredUser(user: AuthUser) {
  sessionStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function updateStoredUser(user: AuthUser) {
  setStoredUser(user)
}

export function clearAuthSession() {
  sessionStorage.removeItem(USER_KEY)
  signOut({ callbackUrl: '/login' })
}
