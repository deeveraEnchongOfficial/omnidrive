# Google Drive "Shared with me" mirror — design

Date: 2026-10-31

## Intent

Google Drive's "Shared with me" view shows files other people have shared with
the user. OmniDrive's Shared page currently shows only OmniDrive-internal
invites (the `Invite` table) and the Google sync only scans the `omnidrive` app
folder, so shared files are invisible. The user wants shared-with-me files to
appear in OmniDrive automatically, like they do in Google Drive.

## Goals

- After a sync, files shared with the user's connected Google account appear on
  the OmniDrive Shared page.
- Each row shows name, who shared it (owner name/email), size, and mime type.
- Actions per file: **Download** (streamed through OmniDrive) and **Open in
  Drive** (`webViewLink`, new tab).
- Sync stays current: newly shared files appear; unshared/trashed files drop
  off on the next sync.
- Existing connected accounts keep working unchanged; accounts that haven't
  granted the new scope get a reconnect prompt in the UI.

## Non-goals

- Editing, moving, renaming, deleting, or OmniDrive-sharing shared files. The
  owner's Drive is authoritative and `drive.readonly` cannot write.
- Shared **folders** (mirroring files only; shared folders are skipped).
- Shared/Team Drives (`corpora=allDrives`); only the user's `sharedWithMe`
  corpus.
- Importing owned copies (the rejected Option B "Picker import" — may be added
  later as a separate feature).
- OmniDrive invites sent *on* shared files.

## Anti-goals

- Shared files must not leak into All Files, search, trash, batch operations,
  storage stats, or the app-folder sync's deletion sweep.
- Accounts still on the old `drive.file`-only grant must not break or error the
  whole sync — shared sync skips them gracefully.

## Constraints

- MongoDB via Prisma (`db push`, no migrations); `BigInt` sizes.
- `File` table semantics: `folderId = null` means "root of the omnidrive app
  folder". Storing shared files in `File` would pollute every file listing and
  the app-folder sync (`syncGoogleAppFolderFiles`) marks every `File` missing
  from the app-folder listing as deleted — shared files would be destroyed on
  every sync. → Separate `SharedFile` model.
- `drive.readonly` is a Google **restricted** scope: unverified OAuth apps show
  a consent warning and are limited to 100 test users; production use needs
  Google verification. Accepted by the user for this project.
- `ConnectedAccount.scopes` currently stores the *requested* scopes copied from
  `ProviderConfig`, not the token's granted scopes — in the connect callback
  (`callback/route.ts:45`). The Google **sign-in** path already stores granted
  scopes (`account.scope`, `auth.ts:74`). To detect "needs reconnect" we must
  record granted scopes at callback (`tokens.scope`, space-delimited).
- Google sign-in **auto-connects the Drive account** (`auth.ts:53-80`) using
  `GOOGLE_SCOPES` — the sign-in path is the primary way accounts get connected,
  not a secondary flow.
- Disconnect is a soft `status = 'disconnected'` update; rows (and cascades)
  never delete, so stale shared files must be filtered out by account status
  rather than relying on `onDelete: Cascade`.

## Approaches considered

- **A — auto-mirror with `drive.readonly` (chosen).** List
  `sharedWithMe and trashed = false` during sync, mirror rows into a new
  `SharedFile` table, render them on the Shared page. Matches Drive behavior.
  Cost: restricted scope, reconnect required.
- **B — Google Picker import.** Keep `drive.file`; user picks shared files in
  Google's picker and OmniDrive copies them in. No new scope, but manual and
  copies consume quota. Rejected as the primary mechanism.
- **C — `drive.metadata.readonly` mirror.** Metadata-only mirror with
  open-in-Drive links. Same restricted-scope cost as A but cannot download —
  strictly worse.

## Design

### 1. Schema (`prisma/schema.prisma`)

New model, applied with `npm run db:push`:

```prisma
model SharedFile {
  id                 String    @id @default(auto()) @map("_id") @db.ObjectId
  userId             String    @map("user_id") @db.ObjectId
  connectedAccountId String    @map("connected_account_id") @db.ObjectId
  provider           String    @default("google_drive")
  providerFileId     String    @map("provider_file_id")
  name               String
  mimeType           String    @map("mime_type")
  sizeBytes          BigInt    @default(0) @map("size_bytes")
  ownerName          String?   @map("owner_name")
  ownerEmail         String?   @map("owner_email")
  webViewLink        String?   @map("web_view_link")
  sharedAt           DateTime? @map("shared_at")
  status             String    @default("active")
  deletedAt          DateTime? @map("deleted_at")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")
  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  connectedAccount   ConnectedAccount @relation(fields: [connectedAccountId], references: [id], onDelete: Cascade)

  @@unique([connectedAccountId, providerFileId])
  @@index([userId, status])
  @@map("shared_files")
}
```

Add `sharedFiles SharedFile[]` to `ConnectedAccount` and `User`.

### 2. Scopes

`drive.readonly` goes into `GOOGLE_SCOPES` itself (my call — see below), so
both OAuth flows request it:

- `src/lib/google.ts` `GOOGLE_SCOPES` += `https://www.googleapis.com/auth/drive.readonly`.
  This constant feeds the NextAuth Google provider (`auth.ts:34`) **and** the
  connect-url union below — one source of truth.
- `src/app/api/system/google-config/route.ts` POST default `scopes` += same.
- `scripts/seed-google-config.ts` hardcoded scope list += same.
- `connect-url/route.ts`: request the union
  `Array.from(new Set([...(config.scopes as string[]), ...GOOGLE_SCOPES]))` so
  existing `ProviderConfig` rows pick up the new scope without a DB migration.
- `callback/route.ts`: store **granted** scopes —
  `tokens.scope?.split(' ')` falling back to requested scopes — passed to
  `connectGoogleDriveAccount`, so `needsReconnect` detection is accurate.
  (The sign-in path at `auth.ts:74` already stores granted scopes.)

Why `GOOGLE_SCOPES` and not a connect-only list: Google sign-in auto-connects
the Drive account — for those users the sign-in grant *is* the only grant.
Withholding the scope there would strand them behind a reconnect prompt they
can only clear by running a second OAuth flow. The consent cost is identical
at whichever moment Drive access is requested.

### 3. Sync (`src/lib/google.ts`)

New `syncGoogleSharedFiles(accountId, userId)`:

- Early-return `{ skipped: true }` if `account.scopes` lacks `drive.readonly`.
- `drive.files.list`, `q: "sharedWithMe and trashed = false and mimeType != '<folder mime>'"`,
  `spaces: 'drive'`, `pageSize: 1000`, `orderBy: 'sharedWithMeTime desc'`,
  paginate; fields:
  `nextPageToken,files(id,name,mimeType,size,owners(displayName,emailAddress),webViewLink,createdTime,sharedWithMeTime)`.
- Upsert `SharedFile` by `(connectedAccountId, providerFileId)`; update
  name/mimeType/size/owner/link. `sharedAt` ← `sharedWithMeTime`, falling back
  to `createdTime`.
- Mark previously-active rows absent from the listing as
  `status: 'deleted', deletedAt: now`.
- On Google `insufficientPermissions`/`invalid_grant`, swallow → set
  `account.lastError` and return skipped (does not fail the whole sync).
- `POST /api/files/sync-google`: call it per account after
  `syncGoogleAppFolderFiles`, and isolate per-account failures — catch errors
  per account and append `{ accountId, error }` entries to `results` instead
  of aborting the whole request (one dead token must not hide everyone's
  shared files). Keeps the existing `results` array shape the Files page reads.

### 4. API

- `GET /api/shared/files` → `{ files: [...], total: number, needsReconnect: boolean }`.
  `files` = active `SharedFile` rows for the user whose
  `connectedAccount.status = 'connected'` (disconnected accounts' files are
  hidden but kept in DB so reconnect restores them), serialized `sizeBytes`,
  `orderBy: sharedAt desc`, `take: 200` — hard cap for v1; `total` returns the
  full count so the UI can note truncation. `needsReconnect` = any *connected*
  google_drive account whose stored scopes lack `drive.readonly`.
- `GET /api/shared/files/[id]/download` → auth + ownership check
  (`userId`, `status: 'active'`, connected account `status: 'connected'`),
  then stream via the Google branch of `src/lib/stream-file.ts`.
  `streamProviderFile` takes `File & { connectedAccount }`; the Google path
  only reads `provider/providerFileId/mimeType/name/connectedAccount`, all
  present on `SharedFile` — widen/extract the Google streaming helper so it
  accepts a structural type rather than `File`. (`SharedFile.provider` is
  always `google_drive`, so the S3 branch is irrelevant. Google-native
  Docs/Sheets/Slides get export handling for free via
  `googleDownloadExportMimeTypes`.)

### 5. UI — `src/app/(drive)/shared/page.tsx`

- Fetch `/api/shared/files` alongside `/api/invites`.
- "Shared With You" card: OmniDrive invites first, then a "From Google Drive"
  subsection listing shared files — name, `Shared by <ownerName ?? ownerEmail>`,
  size, shared date; buttons: Download, Open in Drive (`target=_blank`).
- If `needsReconnect`: inline notice "Reconnect your Google account to see
  files shared with you" linking to the existing connect flow
  (`/api/connected-accounts/google/connect-url` → redirect to `url`).
- Keep invites empty-state when both sources are empty; show shared files even
  when there are no invites.
- Add a small "Sync" button on the Shared page that POSTs
  `/api/files/sync-google` then reloads both lists (reuses existing endpoint).
- Metric cards unchanged (they count invites).

## My calls (defaults chosen without asking)

- Shared files appear only on the Shared page — not All Files, search, or the
  folder tree. They aren't the user's files; putting them in the file model
  would contaminate quotas, trash, and batch ops.
- Download + Open-in-Drive only; no OmniDrive preview-token machinery for
  shared files in v1 (Drive's own viewer covers preview).
- Mirror files only; shared folders skipped.
- Granted-scope recording added at callback (small, needed for correct
  reconnect detection).
- `sharedAt` maps from `sharedWithMeTime` (fallback `createdTime`); listing
  sorted server-side by `sharedWithMeTime desc`.
- API caps at 200 most recent shared files (returns `total`); no pagination UI.
- Per-account sync errors are isolated and reported per account, not thrown.
- `GOOGLE_SCOPES` (one list for sign-in + connect) carries `drive.readonly`;
  sign-in auto-connect is the primary connection path, so the scope must be
  requested there too — consent cost is the same either way.

## Open risks

- Restricted-scope consent warning for unverified OAuth apps — user accepted.
- `drive.readonly` grants read over the *whole* Drive, not just shared files —
  broader grant than the feature strictly needs, but the app only queries
  `sharedWithMe`.
- First sync after reconnect may be slow for accounts with thousands of shared
  files (paginated at 1000/page — acceptable).
