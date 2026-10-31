import { PrismaClient } from '@prisma/client'
import { google } from 'googleapis'
import { getAuthedGoogleClient } from '../src/lib/google'

const prisma = new PrismaClient()
const account = await prisma.connectedAccount.findFirstOrThrow({ where: { email: 'deveraflorencio18@gmail.com' }, include: { providerConfig: true } })
const auth = await getAuthedGoogleClient(account)
const drive = google.drive({ version: 'v3', auth })

for (const q of ['starred = true and trashed = false', 'starred = true and trashed = false and mimeType != \'application/vnd.google-apps.folder\'']) {
  try {
    const res = await drive.files.list({ q, spaces: 'drive', fields: 'files(id,name,starred)', pageSize: 10 })
    console.log(`Q: ${q}`)
    console.log('count:', res.data.files?.length ?? 0, '| names:', (res.data.files ?? []).map(f => `${f.name} [starred=${f.starred}]`).join(', '))
  } catch (e) {
    console.log(`Q: ${q} → ERROR:`, e instanceof Error ? e.message : e)
  }
}
await prisma.$disconnect()
