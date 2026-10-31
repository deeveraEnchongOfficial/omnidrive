'use client'

import { useEffect, useState } from 'react'
import { Clock, Download, ExternalLink, FileArchive, Folder, RefreshCw, Trash2, Users, UserCheck } from 'lucide-react'
import { MetricCard } from '@/components/drive/MetricCard'
import { PageHeader } from '@/components/drive/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { cn } from '@/lib/utils'

type InviteTarget = { id: string; name: string; type: 'file' | 'folder'; mimeType?: string; sizeBytes?: string }
type Invite = {
  id: string
  email: string
  role: string
  status: string
  targetType: 'file' | 'folder'
  targetId: string
  target: InviteTarget | null
  createdAt: string
  acceptedAt: string | null
  user: { id: string; name: string; email: string } | null
}
type SharedFileItem = {
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

function ResourceIcon({ type }: { type: 'file' | 'folder' }) {
  return type === 'folder' ? <Folder className="h-5 w-5 text-muted-foreground" /> : <FileArchive className="h-5 w-5 text-muted-foreground" />
}

export default function SharedPage() {
  const [sentInvites, setSentInvites] = useState<Invite[]>([])
  const [receivedInvites, setReceivedInvites] = useState<Invite[]>([])
  const [sharedFiles, setSharedFiles] = useState<SharedFileItem[]>([])
  const [sharedTotal, setSharedTotal] = useState(0)
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const [reconnectEmails, setReconnectEmails] = useState<string[]>([])
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')
  const pendingCount = sentInvites.filter((invite) => invite.status === 'pending').length
  const acceptedCount = sentInvites.filter((invite) => invite.status === 'accepted').length

  async function loadShared() {
    const [inviteData, sharedData] = await Promise.all([
      apiFetch<{ sent: Invite[]; received: Invite[] }>('/invites'),
      apiFetch<{ files: SharedFileItem[]; total: number; needsReconnect: boolean; reconnectEmails: string[] }>('/shared/files'),
    ])
    setSentInvites(inviteData.sent)
    setReceivedInvites(inviteData.received)
    setSharedFiles(sharedData.files)
    setSharedTotal(sharedData.total)
    setNeedsReconnect(sharedData.needsReconnect)
    setReconnectEmails(sharedData.reconnectEmails)
  }

  useEffect(() => {
    loadShared().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to load shared resources'))
    window.addEventListener('omnidrive:invites-changed', loadShared)
    return () => window.removeEventListener('omnidrive:invites-changed', loadShared)
  }, [])

  async function revokeInvite(id: string) {
    await apiFetch(`/invites/${id}`, { method: 'DELETE' })
    await loadShared()
  }

  async function syncDrive() {
    setSyncing(true)
    try {
      await apiFetch('/files/sync-google', { method: 'POST', body: JSON.stringify({}) })
      await loadShared()
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
        title="Shared"
        description="Files and folders shared with members or shared with you."
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
          <p>Reconnect {reconnectEmails.length > 0 ? reconnectEmails.join(', ') : 'your Google account'} to see files shared with you.</p>
          <Button size="sm" variant="outline" onClick={reconnectGoogle}>Reconnect</Button>
        </div>
      ) : null}
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <MetricCard label="Shared Resources" value={String(sentInvites.length + receivedInvites.length)} icon={Users} />
        <MetricCard label="Accepted Members" value={String(acceptedCount)} icon={UserCheck} />
        <MetricCard label="Pending Invites" value={String(pendingCount)} icon={Clock} />
      </div>

      <Card className="mt-8 p-5">
        <h2 className="font-semibold">Shared With You</h2>
        <div className="mt-4 grid gap-3">
          {receivedInvites.length === 0 && sharedFiles.length === 0 ? <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">No files or folders have been shared with you yet.</p> : null}
          {receivedInvites.map((invite) => (
            <div key={invite.id} className="flex flex-col gap-3 rounded-xl bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <ResourceIcon type={invite.targetType} />
                <div className="min-w-0"><p className="truncate font-semibold text-foreground">{invite.target?.name ?? 'Unavailable resource'}</p><p className="text-sm text-muted-foreground capitalize">{invite.targetType} • {invite.role}{invite.target?.sizeBytes ? ` • ${formatBytes(invite.target.sizeBytes)}` : ''}</p></div>
              </div>
              <span className={cn('w-fit rounded-full px-3 py-1 text-xs font-bold capitalize', invite.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{invite.status}</span>
            </div>
          ))}
          {sharedFiles.length > 0 ? <h3 className="mt-2 text-sm font-bold text-muted-foreground">From Google Drive</h3> : null}
          {sharedFiles.map((file) => (
            <div key={file.id} className="flex flex-col gap-3 rounded-xl bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <ResourceIcon type="file" />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{file.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    Shared by {file.ownerName ?? file.ownerEmail ?? 'unknown'} • {formatBytes(file.sizeBytes)}{file.sharedAt ? ` • ${formatDate(file.sharedAt)}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { window.location.href = `/api/mirrored/files/${file.id}/download` }}><Download className="h-4 w-4" />Download</Button>
                {file.webViewLink ? <Button variant="outline" size="sm" onClick={() => window.open(file.webViewLink as string, '_blank', 'noreferrer')}><ExternalLink className="h-4 w-4" />Open in Drive</Button> : null}
              </div>
            </div>
          ))}
          {sharedTotal > sharedFiles.length ? <p className="text-xs text-muted-foreground">Showing {sharedFiles.length} of {sharedTotal}</p> : null}
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold">Resources You Shared</h2>
        <div className="mt-4 grid gap-3">
          {sentInvites.length === 0 ? <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">No files or folders shared yet. Use Invite Members from the top bar.</p> : sentInvites.map((invite) => (
            <div key={invite.id} className="flex flex-col gap-3 rounded-xl bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <ResourceIcon type={invite.targetType} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{invite.target?.name ?? 'Unavailable resource'}</p>
                  <p className="break-all text-sm text-muted-foreground">Shared with {invite.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Invited {formatDate(invite.createdAt)}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-card px-3 py-1 text-xs font-bold capitalize text-muted-foreground">{invite.role}</span>
                <span className={cn('rounded-full px-3 py-1 text-xs font-bold capitalize', invite.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{invite.status}</span>
                <Button variant="danger" size="sm" onClick={() => revokeInvite(invite.id)}><Trash2 className="h-4 w-4" />Revoke</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}
