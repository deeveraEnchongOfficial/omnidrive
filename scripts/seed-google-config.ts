// Seeds the global Google ProviderConfig from env. Safe to re-run.
// Usage: npx tsx scripts/seed-google-config.ts
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import crypto from 'node:crypto'

const key = crypto.createHash('sha256').update(process.env.TOKEN_ENCRYPTION_KEY ?? '').digest()

function encryptText(value: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`
}

async function main() {
  const clientId = process.env.AUTH_GOOGLE_ID
  const clientSecret = process.env.AUTH_GOOGLE_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    console.log('AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / GOOGLE_REDIRECT_URI not set — skipping seed.')
    return
  }
  const prisma = new PrismaClient()
  const scopes = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.readonly',
  ]
  const existing = await prisma.providerConfig.findFirst({
    where: { user: null, provider: 'google_drive' },
  })
  const data = {
    clientIdEncrypted: encryptText(clientId),
    clientSecretEncrypted: encryptText(clientSecret),
    redirectUri,
    scopes,
    status: 'active',
  }
  if (existing) {
    await prisma.providerConfig.update({ where: { id: existing.id }, data })
    console.log('Updated global Google provider config:', existing.id)
  } else {
    const created = await prisma.providerConfig.create({ data: { ...data, provider: 'google_drive' } })
    console.log('Created global Google provider config:', created.id)
  }
  await prisma.$disconnect()
}

main()
