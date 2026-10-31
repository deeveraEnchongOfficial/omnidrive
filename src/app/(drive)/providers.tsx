'use client'

import type { ReactNode } from 'react'
import { SessionProvider } from 'next-auth/react'
import { UploadProvider } from '@/context/UploadContext'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <UploadProvider>{children}</UploadProvider>
    </SessionProvider>
  )
}
