# OmniDrive

One interface over all your cloud drives. Connect multiple Google Drive and
S3-compatible accounts; OmniDrive pools their free quota into a single virtual
drive with folders, search, sharing, invites, API keys, and an audit log.

Next.js 15 port of 9drive — single app: App Router UI + `/api/*` route handlers.

## Setup

1. `npm install`
2. Copy `.env.example` → `.env`, fill in `DATABASE_URL` (MongoDB Atlas), `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, `GOOGLE_REDIRECT_URI`.
3. `npx prisma db push`
4. `npm run seed:google-config`
5. `npm run dev` → http://localhost:3000

## Commands

- `npm run build` / `npm start` — production build/start
- `npm run db:push` — sync Prisma schema to MongoDB
- `npm run seed:google-config` — write global Google OAuth config to DB
- `npm test` — vitest

## Docker

`docker compose up -d --build` — single Node container (standalone output).
Requires a Node host for large uploads (streams through server to provider).

## Google Cloud

Enable Drive API, create OAuth client, add redirect URI
`<app>/api/connected-accounts/google/callback`. Scopes: `drive.file`, `userinfo.email`, `userinfo.profile`, `openid`.
