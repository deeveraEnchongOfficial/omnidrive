'use client'

import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileArchive, Folder, RefreshCw, Star, StarOff } from 'lucide-react'
import { MetricCard } from '@/components/drive/MetricCard'
import { PageHeader } from '@/components/drive/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { isDriveFolder } from '@/lib/shared-files'

type StarredFile = {
  id: string
  name: string
  mimeType: string
  sizeBytes: string
  starredAt: string | null
  folder?: { id: string; name: string } | null
  connectedAccount?: { email: string; provider: string }
}
type MirroredFileItem = {
  id: string
  name: string
  mimeType: string
  sizeBytes: string
  ownerName: string | null
  ownerEmail: string | null
  webViewLink: string | null
  sharedAt: string | null
  accountEmail: string | null
}

export default function StarredPage() {
  const [starredFiles, setStarredFiles] = useState<StarredFile[]>([])
  const [mirroredFiles, setMirroredFiles] = useState<MirroredFileItem[]>([])
  const [mirroredTotal, setMirroredTotal] = useState(0)
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const [reconnectEmails, setReconnectEmails] = useState<string[]>([])
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')

  async function loadStarred() {
    const [filesData, mirroredData] = await Promise.all([
      apiFetch<{ files: StarredFile[] }>('/files?starred=true'),
      apiFetch<{ files: MirroredFileItem[]; total: number; needsReconnect: boolean; reconnectEmails: string[] }>('/starred/files'),
    ])
    setStarredFiles(filesData.files)
    setMirroredFiles(mirroredData.files)
    setMirroredTotal(mirroredData.total)
    setNeedsReconnect(mirroredData.needsReconnect)
    setReconnectEmails(mirroredData.reconnectEmails)
  }

  useEffect(() => {
    loadStarred().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to load starred files'))
  }, [])

  async function unstarFile(id: string) {
    await apiFetch(`/files/${id}`, { method: 'PATCH', body: JSON.stringify({ starred: false }) })
    await loadStarred()
  }

  async function syncDrive() {
    setSyncing(true)
    try {
      await apiFetch('/files/sync-google', { method: 'POST', body: JSON.stringify({}) })
      await loadStarred()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function reconnectGoogle() {
    const data = await apiFetch<{ url: string }>('/connected-accounts/google/connect-url')
    window.location.href = data.url
  }

  return (
    <>
      <PageHeader
        title="Starred"
        description="Pinned files for quick access."
        actions={(
          <Button size="sm" variant="outline" disabled={syncing} onClick={syncDrive}>
            <RefreshCw className={syncing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            {syncing ? 'Syncing...' : 'Sync'}
          </Button>
        )}
      />
      {message ? <p className="mt-5 rounded-xl bg-muted p-3 text-sm text-foreground">{message}</p> : null}
      {needsReconnect ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
          <p>Reconnect {reconnectEmails.length > 0 ? reconnectEmails.join(', ') : 'your Google account'} to see your Google Drive starred files.</p>
          <Button size="sm" variant="outline" onClick={reconnectGoogle}>Reconnect</Button>
        </div>
      ) : null}
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <MetricCard label="Starred Files" value={String(starredFiles.length)} icon={Star} />
        <MetricCard label="Starred in Google Drive" value={String(mirroredTotal)} icon={Star} />
      </div>

      <Card className="mt-8 p-5">
        <h2 className="font-semibold">Starred</h2>
        <div className="mt-4 grid gap-3">
          {starredFiles.length === 0 ? <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">No starred files yet. Right-click a file and choose Star.</p> : starredFiles.map((file) => (
            <div key={file.id} className="flex flex-col gap-3 rounded-xl bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <Star className="h-5 w-5 shrink-0 fill-yellow-400 text-yellow-400" />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{file.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {formatBytes(file.sizeBytes)}{file.starredAt ? ` • Starred ${formatDate(file.starredAt)}` : ''}{file.folder?.name ? ` • ${file.folder.name}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { window.location.href = `/api/files/${file.id}/download` }}><Download className="h-4 w-4" />Download</Button>
                <Button variant="danger" size="sm" onClick={() => unstarFile(file.id)}><StarOff className="h-4 w-4" />Unstar</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold">Starred in Google Drive</h2>
        <div className="mt-4 grid gap-3">
          {mirroredFiles.length === 0 ? <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">No starred files in Google Drive yet.</p> : mirroredFiles.map((file) => (
            <div key={file.id} className="flex flex-col gap-3 rounded-xl bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                {isDriveFolder(file.mimeType) ? <Folder className="h-5 w-5 shrink-0 text-muted-foreground" /> : <FileArchive className="h-5 w-5 shrink-0 text-muted-foreground" />}
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{file.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {isDriveFolder(file.mimeType) ? 'Folder' : formatBytes(file.sizeBytes)} • Owned by {file.ownerName ?? file.ownerEmail ?? 'you'}{file.accountEmail ? ` • ${file.accountEmail}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!isDriveFolder(file.mimeType) ? <Button variant="outline" size="sm" onClick={() => { window.location.href = `/api/mirrored/files/${file.id}/download` }}><Download className="h-4 w-4" />Download</Button> : null}
                {file.webViewLink ? <Button variant="outline" size="sm" onClick={() => window.open(file.webViewLink as string, '_blank', 'noreferrer')}><ExternalLink className="h-4 w-4" />Open in Drive</Button> : null}
              </div>
            </div>
          ))}
          {mirroredTotal > mirroredFiles.length ? <p className="text-xs text-muted-foreground">Showing {mirroredFiles.length} of {mirroredTotal}</p> : null}
        </div>
      </Card>
    </>
  )
}
