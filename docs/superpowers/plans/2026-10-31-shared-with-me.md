# Shared-With-Me Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror Google Drive "shared with me" files into OmniDrive's Shared page as read-only entries with Download and Open-in-Drive actions.

**Architecture:** New `SharedFile` Prisma model (kept out of `File` so the app-folder sync can't delete it and it can't pollute file listings). `drive.readonly` added to `GOOGLE_SCOPES`; a `syncGoogleSharedFiles` pass runs alongside the existing app-folder sync; two new API routes serve the Shared page.

**Tech Stack:** Next.js 15 App Router (Turbopack), Prisma + MongoDB (`db push`), googleapis, vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-31-shared-with-me-design.md`

## Global Constraints

- New scope constant: `https://www.googleapis.com/auth/drive.readonly` (restricted; consent warning is expected/accepted).
- Never query or write shared items through the `File` model or the app-folder sync — `SharedFile` only.
- `/api/files` (All Files listing) must remain untouched — no shared rows leak in.
- Sync entry `results` array elements must always carry numeric `created/updated/deleted` (the Files page sums them); error entries use zeros plus an `error` field.
- `sizeBytes` is `BigInt` — always serialize with `.toString()` in API responses.
- Match existing code style: `'use client'` pages, `apiFetch` for client calls, `getAuthUser`/`apiError`/`handleRouteError` in routes.

## Review Focus

1. `account.scopes` is a `Json` column and may be non-array (null/string/object on legacy rows): scope checks must not crash → pinned by Task 2 tests.
2. A file unshared between syncs then re-shared: row must go deleted → active again, with `deletedAt` cleared → pinned by Task 3 review step (upsert must set `status:'active', deletedAt:null` on update, not just create).
3. Google-native shared files (Docs/Sheets) download via the export map, not `alt=media` → covered by reusing `streamGoogleFile` unchanged (Task 4), no new code path.
4. `needsReconnect` must ignore disconnected accounts and must be false when scopes are missing-but-upgradeable only via reconnect → Task 5 tests pin the predicate over status/scope combinations.
5. >200 shared files: response caps `files` at 200 while `total` reports the true count → Task 5 test pins cap + total decoupling; Task 6 UI shows "Showing 200 of N" when truncated.

---

### Task 1: SharedFile schema model

**Files:**
- Modify: `prisma/schema.prisma` (add model after `File`, ~line 235; add `sharedFiles SharedFile[]` to `User` and `ConnectedAccount`)

**Interfaces:**
- Produces: `prisma.sharedFile` model — fields per spec §1 exactly: `id, userId, connectedAccountId, provider ('google_drive' default), providerFileId, name, mimeType, sizeBytes BigInt default 0, ownerName?, ownerEmail?, webViewLink?, sharedAt?, status default 'active', deletedAt?, createdAt, updatedAt`; `@@unique([connectedAccountId, providerFileId])`, `@@index([userId, status])`, `@@map("shared_files")`, snake_case `@map` on all fields, cascade to User and ConnectedAccount.

- [ ] **Step 1: Add the `SharedFile` model and both back-relations**

Copy the model block verbatim from spec §1; add `sharedFiles SharedFile[]` to the `User` and `ConnectedAccount` models alongside their existing `files File[]` lines.

- [ ] **Step 2: Validate and push**

Run: `npx prisma validate && npm run db:push`
Expected: schema valid; `db:push` reports the new `shared_files` collection/indexes (MongoDB: "already in sync" or applied indexes — either is success).

- [ ] **Step 3: Regenerate client and typecheck**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: clean; `prisma.sharedFile` resolves in types.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add SharedFile model for Google shared-with-me mirror"
```

---

### Task 2: Scope plumbing + pure scope helpers

**Files:**
- Modify: `src/lib/google.ts:9-14` (GOOGLE_SCOPES)
- Modify: `src/app/api/system/google-config/route.ts:56-61` (hardcoded scopes)
- Modify: `scripts/seed-google-config.ts` (~lines 25-30, same list)
- Modify: `src/app/api/connected-accounts/google/connect-url/route.ts:20`
- Modify: `src/app/api/connected-accounts/google/callback/route.ts:45`
- Create: `src/lib/shared-files.ts` (pure helpers, no googleapis/prisma imports)
- Test: `src/lib/__tests__/shared-files.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (all in `src/lib/shared-files.ts`, a dependency-free pure module — `import type` only for Prisma types; this keeps unit tests fast and the module importable from both `google.ts` and routes without cycles):
  - `export const GOOGLE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'`
  - `export const GOOGLE_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/drive.file', GOOGLE_READONLY_SCOPE]` — **moved** out of `google.ts`; `google.ts` replaces its own definition with `export { GOOGLE_SCOPES } from './shared-files'` so existing importers (`auth.ts:8`, connect-url) keep working unchanged.
  - `export function scopeListHasReadonly(scopes: unknown): boolean` — true iff `scopes` is an array containing `GOOGLE_READONLY_SCOPE`; false for non-arrays, missing, or wrong entries
  - `export function mergeRequiredScopes(requested: unknown): string[]` — `Array.from(new Set([...(Array.isArray(requested) ? requested.filter(s => typeof s === 'string') : []), ...GOOGLE_SCOPES]))`
  - `export function grantedScopes(tokenScope: string | null | undefined, fallback: unknown): string[]` — `tokenScope?.split(' ').filter(Boolean)` if non-empty, else `mergeRequiredScopes(fallback)`

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/shared-files.test.ts` (dynamic-import pattern like `crypto.test.ts`):

```ts
describe('scope helpers', () => {
  it('scopeListHasReadonly detects the readonly scope', () => {
    expect(scopeListHasReadonly(['openid', GOOGLE_READONLY_SCOPE])).toBe(true)
    expect(scopeListHasReadonly(['openid', 'x/drive.file'])).toBe(false)
  })
  it('scopeListHasReadonly survives malformed Json values', () => {
    for (const v of [null, undefined, 'string', 42, { scope: 'x' }]) {
      expect(scopeListHasReadonly(v)).toBe(false)
    }
  })
  it('mergeRequiredScopes unions requested with GOOGLE_SCOPES', () => {
    const merged = mergeRequiredScopes(['openid', 'extra'])
    expect(merged).toContain('extra')
    for (const s of GOOGLE_SCOPES) expect(merged).toContain(s)
    expect(new Set(merged).size).toBe(merged.length)
  })
  it('grantedScopes prefers token scope, falls back to requested', () => {
    expect(grantedScopes('a b', ['c'])).toEqual(['a', 'b'])
    expect(grantedScopes('', ['c'])).toEqual(mergeRequiredScopes(['c']))
    expect(grantedScopes(null, ['c'])).toEqual(mergeRequiredScopes(['c']))
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/__tests__/shared-files.test.ts` → module/hook not found.

- [ ] **Step 3: Implement**

- `shared-files.ts`: implement all exports per Interfaces (constants + three functions).
- `google.ts`: delete its `GOOGLE_SCOPES` definition; replace with `export { GOOGLE_SCOPES } from './shared-files'`.
- `system/google-config/route.ts` and `seed-google-config.ts`: add the readonly URL to each hardcoded scope array.
- `connect-url/route.ts`: replace `scope: config.scopes as string[]` with `scope: mergeRequiredScopes(config.scopes)` (import from `@/lib/shared-files`).
- `callback/route.ts:45`: replace `scopes: oauthState.providerConfig.scopes as string[]` with `scopes: grantedScopes(tokens.scope, oauthState.providerConfig.scopes)`.

- [ ] **Step 4: Run to verify pass** — same vitest command → PASS; then `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shared-files.ts src/lib/__tests__/shared-files.test.ts src/lib/google.ts src/app/api/system/google-config/route.ts scripts/seed-google-config.ts src/app/api/connected-accounts/google/
git commit -m "feat: request drive.readonly and record granted scopes at OAuth callback"
```

---

### Task 3: `syncGoogleSharedFiles` + sync-route isolation

**Files:**
- Modify: `src/lib/google.ts` (new exports + types)
- Modify: `src/app/api/files/sync-google/route.ts`
- Test: extend `src/lib/__tests__/shared-files.test.ts`

**Interfaces:**
- Produces:
  - `export type SharedSyncResult = { accountId: string; created: number; updated: number; deleted: number; skipped?: 'scope' }` (google.ts)
  - `export async function syncGoogleSharedFiles(accountId: string, userId: string): Promise<SharedSyncResult>` (google.ts)
  - `export function toSharedFileData(driveFile: { id?: string|null; name?: string|null; mimeType?: string|null; size?: string|null; owners?: {displayName?: string|null; emailAddress?: string|null}[]|null; webViewLink?: string|null; createdTime?: string|null; sharedWithMeTime?: string|null }): { providerFileId: string; name: string; mimeType: string; sizeBytes: bigint; ownerName: string|null; ownerEmail: string|null; webViewLink: string|null; sharedAt: Date|null } | null` — returns null when `id`/`name`/`mimeType` missing (in `shared-files.ts`; pure)
  - Sync route response: `{ status: 'ok', results: Array<GoogleAppFolderSyncResult & { shared?: SharedSyncResult; error?: string }> }` — error entries keep `created:0, updated:0, deleted:0`.

- [ ] **Step 1: Write the failing test** (append to `shared-files.test.ts`)

```ts
it('toSharedFileData maps a full drive file', () => {
  const row = toSharedFileData({
    id: 'f1', name: 'Doc.pdf', mimeType: 'application/pdf', size: '1234',
    owners: [{ displayName: 'Ann', emailAddress: 'a@x.com' }],
    webViewLink: 'https://drive.google.com/f1', createdTime: '2024-01-01T00:00:00Z',
    sharedWithMeTime: '2024-02-01T00:00:00Z',
  })
  expect(row).toMatchObject({ providerFileId: 'f1', name: 'Doc.pdf', sizeBytes: 1234n, ownerName: 'Ann', ownerEmail: 'a@x.com' })
  expect(row?.sharedAt?.toISOString()).toBe('2024-02-01T00:00:00.000Z')
})
it('toSharedFileData falls back to createdTime and nulls missing fields', () => {
  const row = toSharedFileData({ id: 'f2', name: 'x', mimeType: 'm/m', createdTime: '2024-01-01T00:00:00Z' })
  expect(row?.sizeBytes).toBe(0n); expect(row?.ownerName).toBeNull()
  expect(row?.sharedAt?.toISOString()).toBe('2024-01-01T00:00:00.000Z')
})
it('toSharedFileData returns null on missing required fields', () => {
  expect(toSharedFileData({ name: 'x', mimeType: 'm' })).toBeNull()
  expect(toSharedFileData({ id: 'f', mimeType: 'm' })).toBeNull()
  expect(toSharedFileData({ id: 'f', name: 'x' })).toBeNull()
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/__tests__/shared-files.test.ts` → `toSharedFileData is not a function`.

- [ ] **Step 3: Implement `toSharedFileData` in `src/lib/shared-files.ts`**

Pure mapping per signature; `sharedAt` = `sharedWithMeTime ?? createdTime` parsed to `Date` (null if absent/invalid); `sizeBytes` = `BigInt(size ?? 0)`; owner = `owners?.[0]`.

- [ ] **Step 4: Implement `syncGoogleSharedFiles` in `src/lib/google.ts`**

Mirror `syncGoogleAppFolderFiles` structure:
- Fetch account via `prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId, provider: 'google_drive', status: 'connected' } })`.
- If `!scopeListHasReadonly(account.scopes)` → return `{ accountId, created: 0, updated: 0, deleted: 0, skipped: 'scope' }`.
- `drive.files.list`, `q: "sharedWithMe and trashed = false and mimeType != 'application/vnd.google-apps.folder'"`, `spaces: 'drive'`, `pageSize: 1000`, `orderBy: 'sharedWithMeTime desc'`, fields `nextPageToken,files(id,name,mimeType,size,owners(displayName,emailAddress),webViewLink,createdTime,sharedWithMeTime)`, paginate on `nextPageToken`.
- Map each through `toSharedFileData` (skip nulls); `prisma.sharedFile.upsert` on `connectedAccountId_providerFileId`, `create: {userId, connectedAccountId, provider: 'google_drive', ...data, status: 'active'}`, `update: {...data, status: 'active', deletedAt: null}` (re-share must reactivate — Review Focus #2). Count creates/updates by whether an existing row was found — load existing rows once like the app-folder sync does.
- Sweep: `updateMany` rows for this account `status:'active'` whose `providerFileId` not in the listing → `status:'deleted', deletedAt: now`.
- Wrap the Google call in try/catch: on error, `prisma.connectedAccount.update({data:{lastError: message}})` and rethrow (route-level catch decides per-account reporting).

- [ ] **Step 5: Update `src/app/api/files/sync-google/route.ts`**

Per account, in its own try/catch: `const app = await syncGoogleAppFolderFiles(...)` then `const shared = await syncGoogleSharedFiles(...)` (each independently caught — a scope-skip returns normally; a real failure of either phase still records `shared`/`error` as applicable). Push `{ ...app, shared }` or `{ accountId: account.id, created: 0, updated: 0, deleted: 0, error: message }` on app-sync failure (keep the `results` element shape numeric — Global Constraints).

- [ ] **Step 6: Run tests + typecheck** — vitest PASS; `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/google.ts src/lib/shared-files.ts src/lib/__tests__/shared-files.test.ts src/app/api/files/sync-google/route.ts
git commit -m "feat: sync Google shared-with-me files into SharedFile table"
```

---

### Task 4: Export the Google stream helper

**Files:**
- Modify: `src/lib/stream-file.ts:28`

**Interfaces:**
- Produces: `export async function streamGoogleFile(file: { providerFileId: string; mimeType: string; name: string; connectedAccount: ConnectedAccount }, range: string | undefined, options: StreamOptions): Promise<Response>` — same body, widened param type (currently `FileWithAccount`; narrow to the structural fields it actually reads). `streamProviderFile` keeps its signature and still calls it.

- [ ] **Step 1: Change `streamGoogleFile`'s signature and add `export`**

Add `import type { ConnectedAccount } from '@prisma/client'` if not present. No other changes — `streamProviderFile` passes `FileWithAccount`, which satisfies the narrower type structurally.

- [ ] **Step 2: Typecheck + lint** — `npx tsc --noEmit && npx eslint src/lib/stream-file.ts` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stream-file.ts
git commit -m "refactor: export streamGoogleFile with a structural file type"
```

---

### Task 5: Shared-files API routes

**Files:**
- Create: `src/app/api/shared/files/route.ts`
- Create: `src/app/api/shared/files/[id]/download/route.ts`
- Modify: `src/lib/shared-files.ts` (add serializer + reconnect predicate)
- Test: `src/lib/__tests__/shared-files.test.ts`

**Interfaces:**
- Consumes: `streamGoogleFile` (Task 4), `scopeListHasReadonly` (Task 2), `prisma.sharedFile` (Task 1).
- Produces:
  - `export function serializeSharedFile(row: SharedFile & { connectedAccount?: { email: string } | null }): { id: string; name: string; mimeType: string; sizeBytes: string; ownerName: string | null; ownerEmail: string | null; webViewLink: string | null; sharedAt: string | null; accountEmail: string | null }` — `sizeBytes.toString()`, `sharedAt?.toISOString() ?? null` (shared-files.ts)
  - `export function accountNeedsReconnect(account: { provider: string; status: string; scopes: unknown }): boolean` — true iff `provider === 'google_drive'`, `status === 'connected'`, and `!scopeListHasReadonly(scopes)` (shared-files.ts)
  - `GET /api/shared/files` → `{ files: SerializedSharedFile[]; total: number; needsReconnect: boolean }`
  - `GET /api/shared/files/[id]/download` → binary stream or `apiError` JSON

- [ ] **Step 1: Write the failing test** (append)

```ts
it('serializeSharedFile stringifies BigInt and ISO-dates sharedAt', () => {
  const out = serializeSharedFile({ id: 'x', name: 'n', mimeType: 'm', sizeBytes: 9n, ownerName: null, ownerEmail: 'o@x', webViewLink: 'u', sharedAt: new Date('2024-03-01T00:00:00Z'), connectedAccount: { email: 'me@x' } } as any)
  expect(out.sizeBytes).toBe('9'); expect(out.sharedAt).toBe('2024-03-01T00:00:00.000Z'); expect(out.accountEmail).toBe('me@x')
})
it('accountNeedsReconnect only flags connected google accounts lacking readonly', () => {
  expect(accountNeedsReconnect({ provider: 'google_drive', status: 'connected', scopes: ['x/drive.file'] })).toBe(true)
  expect(accountNeedsReconnect({ provider: 'google_drive', status: 'connected', scopes: [GOOGLE_READONLY_SCOPE] })).toBe(false)
  expect(accountNeedsReconnect({ provider: 'google_drive', status: 'disconnected', scopes: [] })).toBe(false)
  expect(accountNeedsReconnect({ provider: 's3', status: 'connected', scopes: [] })).toBe(false)
})
```

- [ ] **Step 2: Run to verify fail** — vitest → not exported.

- [ ] **Step 3: Implement helpers + routes**

`shared-files.ts`: implement both functions (`serializeSharedFile` types its param as the Prisma row shape; `as any` in the test is acceptable given BigInt/Date).

`src/app/api/shared/files/route.ts` — mirror `src/app/api/files/route.ts` structure:
```ts
const where = { userId: user.id, status: 'active', connectedAccount: { status: 'connected' } }
const [rows, total, accounts] = await Promise.all([
  prisma.sharedFile.findMany({ where, include: { connectedAccount: { select: { email: true } } }, orderBy: { sharedAt: 'desc' }, take: 200 }),
  prisma.sharedFile.count({ where }),
  prisma.connectedAccount.findMany({ where: { userId: user.id, provider: 'google_drive' }, select: { provider: true, status: true, scopes: true } }),
])
return NextResponse.json({ files: rows.map(serializeSharedFile), total, needsReconnect: accounts.some(accountNeedsReconnect) })
```

`src/app/api/shared/files/[id]/download/route.ts` — mirror `src/app/api/files/[id]/download/route.ts`:
```ts
const file = await prisma.sharedFile.findFirst({ where: { id, userId: user.id, status: 'active', connectedAccount: { status: 'connected' } }, include: { connectedAccount: true } })
if (!file) return apiError(404, 'NOT_FOUND', 'Shared file not found.')
return streamGoogleFile(file, request.headers.get('range') ?? undefined, { disposition: 'attachment' })
```

- [ ] **Step 4: Run tests + typecheck** — vitest PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/shared/ src/lib/shared-files.ts src/lib/__tests__/shared-files.test.ts
git commit -m "feat: shared-files list and download API routes"
```

---

### Task 6: Shared page UI

**Files:**
- Modify: `src/app/(drive)/shared/page.tsx`

**Interfaces:**
- Consumes: `GET /api/shared/files` (`{files, total, needsReconnect}`), `POST /api/files/sync-google` (`{results}` — ignore content beyond success), `GET /api/connected-accounts/google/connect-url` (`{url}` — existing; redirect browser to `data.url`).
- Produces: none (UI leaf).

- [ ] **Step 1: Add state and loading**

New state: `sharedFiles` (serialized type — declare a local `SharedFileItem` matching Task 5's serializer output), `sharedTotal`, `needsReconnect`, `syncing`. Extend the mount effect's loader to also fetch `/api/shared/files` (parallel with `/api/invites` via `Promise.all`); keep the `omnidrive:invites-changed` listener reloading both.

- [ ] **Step 2: Render "From Google Drive" inside the Shared With You card**

Below the invites list (or in place of its empty state when invites are empty but shared files exist): a subheading `From Google Drive` + rows matching the card's existing row style — `ResourceIcon type="file"`, name, `Shared by {ownerName ?? ownerEmail ?? 'unknown'}`, `{formatBytes(sizeBytes)}` (sizeBytes arrives as string — `formatBytes` accepts it per existing invite usage), `formatDate(sharedAt)` when present; right side: `<Button size="sm" variant="outline">` wrapping an `<a href={"/api/shared/files/" + f.id + "/download"}>` labeled Download, and an `<a href={f.webViewLink} target="_blank" rel="noreferrer">` Open in Drive (render only when `webViewLink` present). When `total > files.length`, footer line `Showing {files.length} of {total}`.

- [ ] **Step 3: Reconnect notice**

When `needsReconnect`, above the metric cards render the same styled notice as the `message` banner: text `Reconnect your Google account to see files shared with you.` plus a small button that fetches `/api/connected-accounts/google/connect-url` and assigns `window.location.href = data.url`.

- [ ] **Step 4: Sync button**

`PageHeader` actions area (or next to it, matching the Files page pattern at `files/page.tsx:673-677`): a `Sync` button (`RefreshCw` icon, spin while `syncing`) → `POST /files/sync-google`, then re-run the loader. Wrap in try/catch surfacing `error.message` via `setMessage`.

- [ ] **Step 5: Verify** — `npx tsc --noEmit && npx eslint "src/app/(drive)/shared/page.tsx"` → clean (no new warnings).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(drive)/shared/page.tsx"
git commit -m "feat: list Google shared-with-me files on the Shared page"
```

---

### Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Reconnect Google account** (manual, user performs)

Google consent screen will now include the restricted `drive.readonly` scope — expected warning on unverified apps.

- [ ] **Step 2: Trigger sync**

In the running app: Shared page → Sync (or `POST /api/files/sync-google`). Check server log / DB: `shared_files` rows created for the account's shared files; `needsReconnect` flips false after reconnect.

- [ ] **Step 3: UI check**

Shared page shows the shared files from the screenshot's Drive account (e.g. "Change Request Form", "PRoforma tables") under From Google Drive with owner names; Download streams a file; Open in Drive opens the Drive viewer.

- [ ] **Step 4: Edge check**

`db.shared_files` → set one row's account to a `drive.file`-only scope account OR unshare a file in Google Drive → re-sync → row marked deleted / hidden from API; disconnected-account rows excluded from `/api/shared/files`.

- [ ] **Step 5: Full test suite + lint** — `npm test && npm run lint` → green (only pre-existing warnings).
