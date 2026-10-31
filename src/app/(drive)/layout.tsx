import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth'
import { DriveLayout } from '@/components/drive/DriveLayout'
import { Providers } from './providers'

export default async function DriveGroupLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser()
  if (!user) redirect('/login')
  return (
    <Providers>
      <DriveLayout>{children}</DriveLayout>
    </Providers>
  )
}
