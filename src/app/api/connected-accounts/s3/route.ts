import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'
import { encryptText, randomToken } from '@/lib/crypto'
import { syncS3Quota, testS3Connection } from '@/lib/s3'

const s3ConnectSchema = z.object({
  name: z.string().trim().min(1).max(191),
  bucket: z.string().trim().min(1).max(191),
  region: z.string().trim().min(1).max(191),
  endpoint: z.string().url().optional().or(z.literal('')),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  forcePathStyle: z.boolean().optional(),
  quotaBytes: z.string().regex(/^\d+$/).optional().nullable(),
})

export async function POST(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = s3ConnectSchema.parse(await request.json())

    // Link to the global google config when present (parity with the original
    // which required it); S3 accounts don't use it at runtime.
    const providerConfig = await prisma.providerConfig.findFirst({ where: { provider: 'google_drive', status: 'active' }, orderBy: { createdAt: 'desc' } })
    const providerAccountId = `${body.bucket}:${body.endpoint || body.region}`
    const existingAccount = await prisma.connectedAccount.findUnique({ where: { userId_provider_providerAccountId: { userId: user.id, provider: 's3', providerAccountId } } })
    const tokenData = {
      providerConfigId: providerConfig?.id ?? null,
      email: `${body.bucket} (S3)`,
      displayName: body.name,
      accessTokenEncrypted: encryptText('s3'),
      refreshTokenEncrypted: encryptText(randomToken()),
      tokenExpiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
      scopes: [] as string[],
      status: 'connected',
    }
    const account = existingAccount
      ? await prisma.connectedAccount.update({ where: { id: existingAccount.id }, data: tokenData })
      : await prisma.connectedAccount.create({ data: { userId: user.id, provider: 's3', providerAccountId, ...tokenData } })

    const config = await prisma.s3StorageConfig.upsert({
      where: { connectedAccountId: account.id },
      create: {
        userId: user.id,
        connectedAccountId: account.id,
        name: body.name,
        bucket: body.bucket,
        region: body.region,
        endpoint: body.endpoint || null,
        accessKeyIdEncrypted: encryptText(body.accessKeyId),
        secretAccessKeyEncrypted: encryptText(body.secretAccessKey),
        forcePathStyle: body.forcePathStyle ?? Boolean(body.endpoint),
        quotaBytes: body.quotaBytes ? BigInt(body.quotaBytes) : null,
      },
      update: {
        name: body.name,
        bucket: body.bucket,
        region: body.region,
        endpoint: body.endpoint || null,
        accessKeyIdEncrypted: encryptText(body.accessKeyId),
        secretAccessKeyEncrypted: encryptText(body.secretAccessKey),
        forcePathStyle: body.forcePathStyle ?? Boolean(body.endpoint),
        quotaBytes: body.quotaBytes ? BigInt(body.quotaBytes) : null,
        status: 'active',
      },
    })
    try {
      await testS3Connection(config)
      const quota = await syncS3Quota(account.id)
      return NextResponse.json({
        account: {
          ...account,
          storageAccount: { ...quota, totalBytes: quota.totalBytes?.toString() ?? null, usedBytes: quota.usedBytes.toString(), availableBytes: quota.availableBytes?.toString() ?? null, trashBytes: quota.trashBytes?.toString() ?? null },
        },
      }, { status: 201 })
    } catch (error) {
      if (!existingAccount) await prisma.connectedAccount.delete({ where: { id: account.id } }).catch(() => undefined)
      throw error
    }
  } catch (error) {
    return handleRouteError(error)
  }
}
