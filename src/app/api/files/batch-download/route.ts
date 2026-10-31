import { z } from 'zod'
import { google } from 'googleapis'
import { ZipArchive } from 'archiver'
import { PassThrough, Readable } from 'node:stream'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError } from '@/lib/http'
import { getAuthedGoogleClient } from '@/lib/google'
import { createS3Client, getS3ConfigForAccount } from '@/lib/s3'
import { googleDownloadExportMimeTypes, normalizeHeaders, withExtension } from '@/lib/stream-file'
import { GetObjectCommand } from '@aws-sdk/client-s3'

export async function POST(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = z.object({ fileIds: z.array(z.string().min(1)).min(1).max(100) }).parse(await request.json())
    const files = await prisma.file.findMany({
      where: { id: { in: body.fileIds }, userId: user.id, status: 'active' },
      include: { connectedAccount: true }
    })
    if (files.length === 0) return apiError(404, 'FILES_NOT_FOUND', 'No files found.')

    const archive = new ZipArchive({ zlib: { level: 9 } })
    const passthrough = new PassThrough()
    archive.pipe(passthrough)

    const fill = (async () => {
      for (const file of files) {
        try {
          let stream: Readable
          let fileName = file.name
          if (file.provider === 's3') {
            const config = await getS3ConfigForAccount(file.connectedAccountId)
            const client = createS3Client(config)
            const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: file.providerFileId }))
            stream = response.Body as Readable
          } else {
            const auth = await getAuthedGoogleClient(file.connectedAccount)
            const headers = normalizeHeaders(await auth.getRequestHeaders())
            const exportTarget = googleDownloadExportMimeTypes[file.mimeType]
            if (exportTarget) {
              fileName = withExtension(file.name, exportTarget.extension)
            }
            const url = exportTarget
              ? `https://www.googleapis.com/drive/v3/files/${file.providerFileId}/export?mimeType=${encodeURIComponent(exportTarget.mimeType)}`
              : `https://www.googleapis.com/drive/v3/files/${file.providerFileId}?alt=media`
            const response = await fetch(url, { headers })
            if (!response.ok || !response.body) continue
            stream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
          }
          archive.append(stream, { name: fileName })
        } catch (err) {
          console.error(`Failed to add file ${file.name} to zip:`, err)
        }
      }
      await archive.finalize()
    })()

    fill.catch((err) => {
      console.error('Zip creation failed:', err)
      passthrough.destroy(err)
    })

    return new Response(Readable.toWeb(passthrough) as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="omnidrive-download.zip"',
      },
    })
  } catch (error) {
    console.error('[batch-download]', error)
    return apiError(500, 'INTERNAL_ERROR', 'Something went wrong.')
  }
}
