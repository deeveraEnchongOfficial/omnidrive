import { Readable } from 'node:stream'
import { getAuthedGoogleClient } from './google'
import { contentDisposition, getS3ObjectStream, type FileWithAccount } from './s3'

type StreamOptions = { disposition?: 'inline' | 'attachment' }

export const googleDownloadExportMimeTypes: Record<string, { mimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.spreadsheet': { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx' },
  'application/vnd.google-apps.presentation': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.drawing': { mimeType: 'image/png', extension: '.png' },
}

const googlePreviewExportMimeTypes: Record<string, { mimeType: string; extension: string }> = {
  ...googleDownloadExportMimeTypes,
  'application/vnd.google-apps.spreadsheet': { mimeType: 'application/pdf', extension: '.pdf' },
}

export function withExtension(fileName: string, extension: string) {
  return fileName.toLowerCase().endsWith(extension) ? fileName : `${fileName}${extension}`
}

export function normalizeHeaders(headers: Headers | Record<string, string>) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  return headers
}

async function streamGoogleFile(file: FileWithAccount, range: string | undefined, options: StreamOptions) {
  const auth = await getAuthedGoogleClient(file.connectedAccount)
  const headers = normalizeHeaders(await auth.getRequestHeaders())
  const exportTarget = (options.disposition === 'inline' ? googlePreviewExportMimeTypes : googleDownloadExportMimeTypes)[file.mimeType]
  const responseMimeType = exportTarget?.mimeType ?? file.mimeType
  const responseFileName = exportTarget ? withExtension(file.name, exportTarget.extension) : file.name
  const url = exportTarget
    ? `https://www.googleapis.com/drive/v3/files/${file.providerFileId}/export?mimeType=${encodeURIComponent(exportTarget.mimeType)}`
    : `https://www.googleapis.com/drive/v3/files/${file.providerFileId}?alt=media`
  const response = await fetch(url, {
    headers: {
      ...headers,
      ...(range && !exportTarget ? { Range: range } : {}),
    },
  })

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText)
    return Response.json({ code: 'GOOGLE_FILE_STREAM_FAILED', message: message || response.statusText }, { status: response.status })
  }

  const responseHeaders = new Headers({
    'Content-Type': responseMimeType,
    'Accept-Ranges': 'bytes',
  })
  if (options.disposition) responseHeaders.set('Content-Disposition', contentDisposition(options.disposition, responseFileName))
  const contentLength = response.headers.get('content-length')
  const contentRange = response.headers.get('content-range')
  if (contentLength) responseHeaders.set('Content-Length', contentLength)
  if (contentRange) responseHeaders.set('Content-Range', contentRange)

  return new Response(response.body, { status: response.status === 206 ? 206 : 200, headers: responseHeaders })
}

async function streamS3File(file: FileWithAccount, range: string | undefined, options: StreamOptions) {
  const { status, contentType, contentLength, contentRange, body } = await getS3ObjectStream(file, range)
  const headers = new Headers({
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  })
  if (options.disposition) headers.set('Content-Disposition', contentDisposition(options.disposition, file.name))
  if (contentLength !== undefined) headers.set('Content-Length', contentLength.toString())
  if (contentRange) headers.set('Content-Range', contentRange)
  if (!body) return new Response(null, { status, headers })
  return new Response(Readable.toWeb(body) as ReadableStream, { status, headers })
}

export function streamProviderFile(file: FileWithAccount, range: string | undefined, options: StreamOptions = {}) {
  if (file.provider === 's3') return streamS3File(file, range, options)
  return streamGoogleFile(file, range, options)
}
