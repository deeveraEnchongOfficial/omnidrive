# OmniDrive — Implementation Plan

A full-featured, single-app Next.js port of **9drive** (`/Users/Emmanuel/Downloads/9drive-main`).

## What we're building

A multi-account cloud storage gateway. Users sign in (email/password or Google), connect one
or more storage accounts — Google Drive and S3-compatible — and OmniDrive pools their free
quota into a single virtual drive. Uploads stream through the server into whichever connected
account has room (configurable routing). Files land in the provider's `omnidrive` folder;
folders exist only in the database. On top of that: nested folders, search, star/trash/archive,
public share links, email invites, preview tokens, per-user API keys with scopes, an audit
log, upload routing policies, admin Google-config/backup tools, and a PWA-capable UI.

**Feature target: full parity with 9drive.**

## Decisions

| Question | Decision | Why |
|---|---|---|
| Name | **OmniDrive** | One interface over all your drives |
| Scope | Full parity with 9drive | User-selected |
| Framework | Next.js 15 App Router (single app) | Collapses Express backend + Vite frontend into one deployable |
| Database | **MongoDB Atlas** via Prisma | User-provided URI; Prisma supports MongoDB |
| Auth | **Auth.js v5** (Credentials + Google, JWT sessions) + server-side session registry | Standard Next.js auth; registry row preserves 9drive's revocation/expiry semantics |
| Uploads | Server-streamed (Busboy on `request.body` → provider) | Parity with original; no files on disk |
| Hosting | Node server (`output: 'standalone'`, Docker) | Serverless can't stream multi-GB uploads or hold long connections |
| Provider folder name | `omnidrive` (was `9drive`) | Rebrand |

## Approach — how the two apps merge

| 9drive | OmniDrive |
|---|---|
| Express routers (`backend/src/modules/*`) | Route handlers `app/api/<feature>/route.ts` |
| `requireAuth` middleware | `auth()` from Auth.js in a `getAuthUser()` helper + `middleware.ts` for page protection |
| `requireApiKey` middleware | `lib/api-key.ts` helper for `/api/v1/*` routes |
| Vite pages + React Router | `app/` routes; dashboard pages are `'use client'` (they're interactive SPA-style screens) |
| `VITE_API_URL` + CORS | Same-origin `/api` — no CORS needed |
| `VITE_RECAPTCHA_SITE_KEY` | `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` |
| Bearer access/refresh tokens in `localStorage` | Auth.js session cookie; `apiFetch` drops token handling |
| `prisma migrate` (MySQL) | `prisma db push` (MongoDB has no migrations) |
| nginx + 3 containers | Single Node process (docker-compose optional: app only, Atlas is managed) |
| `vite-plugin-pwa` | Serwist/`next-pwa` (stretch goal, last) |

### Things that need real redesign (not mechanical ports)

1. **Upload streaming.** Original pipes Busboy → Google resumable upload / S3. In a route
   handler: `Readable.fromWeb(request.body)` → same Busboy pipeline → same provider services.
   Works on the Node.js runtime. **Do not** use `request.formData()` — it buffers entire files.
2. **Sign-in vs Drive-connect.** Two different OAuth flows, kept separate as in 9drive:
   - **Sign-in:** Auth.js Google provider (identity only). On first Google sign-in, request
     `drive.file` scope + `access_type=offline` + `prompt=consent` and auto-create the first
     `ConnectedAccount` from the OAuth tokens (parity with "auto-connect on Google sign-in").
   - **Connect additional accounts:** custom OAuth flow — build URL from the DB-stored
     `ProviderConfig`, state-hash table, callback exchanges code and stores encrypted tokens.
3. **Google credentials.** Original stores them encrypted in `ProviderConfig` (seeded from
   env, editable in Settings). Auth.js needs them at init, so `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`
   live in env; a seed script still writes the `ProviderConfig` row, which all Drive-runtime
   code reads — preserving the original's behavior.
4. **Session revocation.** Auth.js JWT sessions are stateless. Keep the `UserSession` model:
   create a row on sign-in (id embedded in JWT), validate it in the `session` callback,
   revoke on sign-out. Preserves 9drive's expiry/revoke semantics.
5. **Prisma schema → MongoDB.** Provider `mongodb`; ids `@id @default(auto()) @map("_id") @db.ObjectId`
   (or keep `uuid()` strings — pick ObjectId, it's idiomatic). Strip all `@db.VarChar/Char/Text`
   annotations. Json fields, `@@unique`, `@@index`, BigInt all supported. Cascades are emulated
   by Prisma Client. FK ids stay `String ... @db.ObjectId`.
6. **Self-update** (`system` module runs `update.sh`/`git pull`): keep endpoints but mark
   optional — it only makes sense on a self-hosted Node deploy, same as before.

## Stack

- Next.js 15, React 19, TypeScript (strict), App Router
- Tailwind CSS 4 + lucide-react + CVA + clsx + tailwind-merge (same design system; port `components/ui` and `components/drive` as-is)
- Auth.js v5 (`next-auth@5`), Argon2 (`argon2`) for passwords
- Prisma 6 + MongoDB Atlas
- googleapis, undici (Google streaming), @aws-sdk/lib-storage + client-s3 (S3)
- Busboy, zod, jsonwebtoken not needed (Auth.js owns JWT)
- reCAPTCHA (optional, env-gated, same as original)

## Directory layout

```
omnidrive/
├── prisma/schema.prisma          # ported to MongoDB
├── src/
│   ├── app/
│   │   ├── (auth)/login|register/page.tsx
│   │   ├── (drive)/layout.tsx             # DriveLayout port: sidebar, search, quota widget
│   │   │   ├── files/page.tsx             # AllFilesPage
│   │   │   ├── recent|starred|trash|archived|shared|quota|activity|api-keys|settings/page.tsx
│   │   ├── f/[token]/page.tsx             # PublicFilePage (public, embeddable)
│   │   ├── auth/google/page.tsx           # Google connect handoff landing
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts + register/route.ts + google/exchange/route.ts
│   │       ├── files/[...]/route.ts       # CRUD, batch, share, preview-token, view-url, download, sync-google, preview/:token
│   │       ├── folders/route.ts           # CRUD, recent
│   │       ├── uploads/route.ts           # Busboy stream → provider router
│   │       ├── connected-accounts/[...]/route.ts  # google connect-url/connect/callback, list, sync-quota, delete
│   │       ├── provider-configs/route.ts
│   │       ├── storage/summary|breakdown/route.ts
│   │       ├── invites/route.ts
│   │       ├── api-keys/route.ts
│   │       ├── audit-logs/route.ts
│   │       ├── public/files/[token]/route.ts      # + /download, /preview
│   │       ├── system/[...]/route.ts      # google-config, backup, restore, update-log
│   │       └── v1/uploads/route.ts        # external API, API-key guarded
│   ├── components/{ui,drive,auth}/        # ported 1:1
│   ├── lib/
│   │   ├── auth.ts          # Auth.js config, getAuthUser()
│   │   ├── prisma.ts        # singleton client
│   │   ├── crypto.ts        # encryptText/decryptText/randomToken/hashToken (port as-is)
│   │   ├── audit.ts         # createAuditLog
│   │   ├── api-key.ts       # scope check + hashed-key lookup
│   │   ├── google.ts        # google.service port
│   │   ├── s3.ts            # s3.service port
│   │   ├── stream-file.ts   # provider-branched streaming
│   │   ├── api.ts           # apiFetch client helper (no bearer tokens)
│   │   └── utils.ts         # cn, formatters
│   └── middleware.ts        # protects (drive) routes, lets /f/* and /api/public|v1 through
├── scripts/seed-google-config.ts
├── .env.local                 # secrets — gitignored
├── docker-compose.yml         # app-only (Atlas is managed)
└── Dockerfile
```

## Environment variables (`.env.local`)

```
DATABASE_URL            # mongodb+srv://... Atlas URI (DBName → omnidrive)
AUTH_SECRET             # openssl rand -base64 32
AUTH_GOOGLE_ID          # Google OAuth client id (sign-in)
AUTH_GOOGLE_SECRET      # Google OAuth client secret
GOOGLE_REDIRECT_URI     # e.g. http://localhost:3000/api/connected-accounts/google/callback
TOKEN_ENCRYPTION_KEY    # for encrypting provider creds/tokens at rest
MAX_UPLOAD_BYTES        # default 5GB
NEXT_PUBLIC_RECAPTCHA_SITE_KEY   # optional
RECAPTCHA_SECRET_KEY               # optional
```

## Data model

Port all 16 models 1:1: `User`, `UserSession`, `AuthHandoff`, `ProviderConfig`,
`OauthState`, `ConnectedAccount`, `S3StorageConfig`, `StorageAccount`, `File`,
`FileShare`, `FilePreviewToken`, `Folder`, `UploadSession`, `AuditLog`,
`WorkspaceInvite`, `UploadRoutingPolicy`, `ApiKey`.

MongoDB changes only: `@id @default(auto()) @map("_id") @db.ObjectId`, FK fields
`@db.ObjectId`, drop `@db.*` type annotations, `provider = "mongodb"`.
JSON responses must still serialize BigInt → string.

## API surface (parity)

All routes from `AGENTS.md` map under `/api/` — auth register/exchange/refresh/logout/me,
provider-configs, connected-accounts (connect-url/connect/callback/sync-quota), storage
summary/breakdown, folders (list/all/recent/CRUD), files (list/search/get/patch/batch/delete/
sync-google/share/preview-token/view-url/download/preview-by-token), invites, public
files (meta/download/preview), uploads, api-keys, audit-logs, system (google-config,
backup, restore, update-log), `/api/v1/uploads` (API-key `files:upload` scope).
Stable JSON error shape `{ code, message }` preserved.

## Build phases

**Phase 0 — Scaffold.** `create-next-app` (TS, Tailwind, App Router, `src/`). Deps:
`next-auth@5 argon2 prisma @prisma/client googleapis undici busboy @types/busboy
@aws-sdk/client-s3 @aws-sdk/lib-storage zod lucide-react class-variance-authority clsx
tailwind-merge`. Init git. `.env.local` with Atlas URI. Port `utils/crypto.ts`, `prisma` singleton.

**Phase 1 — Schema + seed.** Port schema to MongoDB, `prisma db push`, `prisma generate`.
Port `seed-google-config` script.

**Phase 2 — Auth.** Auth.js config (Credentials + Google w/ Drive-scope auto-connect),
register API (Argon2, optional reCAPTCHA), UserSession registry create/validate/revoke,
`middleware.ts` protection, login/register pages, `GoogleAuthPage` equivalent.

**Phase 3 — Connected accounts + providers.** `google.ts` (client, `ensureGoogleAppFolder`,
quota sync, resumable upload helper), `s3.ts`, provider-config routes, connected-accounts
routes + OAuth connect flow, Settings page account section, QuotaTrackerPage.

**Phase 4 — Core drive.** Folder CRUD + nested tree, file CRUD/list/search/batch/star,
uploads route (Busboy stream → `selectAccount` routing: most_available/round_robin/priority,
per-request reserved-bytes accounting, stale-quota resync), download/view-url streaming,
`sync-google` reconciliation, UploadContext (queue + progress panel), AllFilesPage,
DriveLayout shell, Recent/Starred/Trash/Archived pages.

**Phase 5 — Sharing.** Share-link create/revoke, preview tokens, public `/f/[token]` page
(meta + preview + download, embeddable), workspace invites, SharedPage.

**Phase 6 — External API + audit.** ApiKey CRUD + hashed storage + scopes,
`/api/v1/uploads` reusing `handleUpload`, audit-log writes across mutations, ActivityLogPage,
ApiManagementPage.

**Phase 7 — System + polish.** google-config/backup/restore/update-log endpoints,
system section in Settings, error/empty states, responsive pass, PWA (stretch).

**Phase 8 — Ship.** Dockerfile (`output: 'standalone'`), docker-compose, README
(Google Cloud + Atlas + deploy instructions), verification.

## Security invariants (carried over)

- No secrets in repo; `.env.local` gitignored. Never log tokens/keys/raw share tokens.
- Google tokens + S3 keys + provider creds encrypted at rest (AES-256-GCM, ported `crypto.ts`).
- Refresh/session tokens, share tokens, preview tokens, API keys stored hashed.
- Uploaded bytes never touch disk — stream request → provider.
- reCAPTCHA verified on register only when `RECAPTCHA_SECRET_KEY` set.
- Public-token routes bypass session auth; verify hash + enabled + expiry before streaming.
- `bigint` → string before JSON responses.

## Verification

- `npm run build` (typecheck + build) after every phase; `prisma db push` after schema edits.
- Manual smoke (parity with original): register/login → Settings → connect Google Drive →
  Quota sync → nested folders → upload w/ progress → search → preview/download/rename/move/
  share/invite/delete → Shared page → public link → (S3 connect → same smoke) → API key
  upload via `curl` → activity log shows events.

## Risks / open items

- **Large uploads** need a Node host without request-size/timeout caps — plan targets Docker/VPS, not Vercel serverless.
- **Auth.js v5 is still `beta`**-tagged; pinning to a specific beta in package.json.
- **PWA** under App Router needs Serwist; kept as last stretch item.
- `system` self-update only makes sense self-hosted; endpoints kept, flagged optional.
- Atlas URI password lives only in `.env.local` — not committed.
