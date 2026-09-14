# Vercel Cloud Migration Plan

## Objective

Move TRIPLE DIMENSION from a Raspberry Pi/SQLite/local-file architecture to a
public HTTPS web application on Vercel. This migration is complete: the app
now runs entirely on Vercel with no Pi, no SQLite, and no local file storage
anywhere in its deployment.

## Target Architecture

```text
Browser → Vercel Express Function → Neon PostgreSQL
                             ├── Vercel Blob (private uploads)
                             └── Upstash Redis (sessions and rate limits)
```

## Delivery Phases

### 1. Application refactor

- [x] Split the Express app from its local `listen()` process so Vercel can
  invoke it as a function.
- [x] Add Vercel routing/configuration and production-safe proxy/cookie rules.
- [x] Replace the in-memory session store with Redis in production.
- [x] Add rate limiting to login and mutation endpoints.

### 2. Storage retirement

- [x] Replace Multer disk uploads with private Vercel Blob objects.
- [x] Store object metadata instead of local disk paths.
- [x] Remove the local NAS feature entirely: the `NasCategory`, `NasFolder`,
  and `NasFile` Prisma models, the `/nas` routes, the NAS admin views, and
  every NAS-related field on `FabricationFile`, `Subscriber`, and
  `SubscriberActivity` have all been dropped from `prisma/schema.prisma`.
  There is no NAS drive, mount, or record of any kind in this application
  anymore.

### 3. Telegram bot retirement

- [x] Remove the Telegram bot entirely: `telegram-bot.js` no longer runs,
  the `TelegramAccount`, `TelegramLinkCode`, `TelegramJobDraft`, and
  `TelegramProcessedUpdate` Prisma models are gone, the "Telegram code"
  admin action is gone from Manage Users, and the `npm run telegram:bot`
  script has been removed from `package.json`. There is no Telegram
  integration anywhere in this app.

### 4. Raspberry Pi / self-hosting retirement

- [x] Remove all Pi/self-hosting deployment material. This app is not
  deployed on a Raspberry Pi or any other self-hosted machine — it runs
  exclusively as a Vercel serverless function. The `deploy/*.service.example`
  systemd unit files are retired and do nothing.

### 5. Database migration

- [x] Change Prisma from SQLite to PostgreSQL.
- [x] Replace financial `Float` columns with fixed-precision `Decimal`.
- [x] Generate a clean PostgreSQL baseline migration (`prisma/migrations/0_init`).
- [x] Remove the legacy SQLite-dialect migration folders from
  `prisma/migrations/` — they were retained as history for a while, but since
  `0_init` is a complete, self-contained baseline of the current schema, and
  `migrate deploy` applies any local folder not yet in a target database's
  history in filename order, leaving the SQLite-dialect folders in place broke
  a `migrate deploy` against any genuinely fresh Postgres database (0_init
  would apply first, then the next legacy folder would fail with invalid
  Postgres syntax). Run `node scripts/consolidate-prisma-migrations.js --yes`
  once, then verify with `npx prisma migrate status` against production and
  follow the script's printed instructions if `0_init` isn't already recorded
  as applied there.
- [x] Add a follow-up migration dropping the Telegram and NAS tables/columns
  (see the dated migration folder added alongside this removal pass) so the
  database matches the current, Telegram/NAS-free `schema.prisma`.
- [x] `scripts/migrate-sqlite-to-postgres.js` (the original SQLite → Postgres
  importer) is retired now that the one-time import it performed is long
  finished and the Telegram/NAS tables it used to copy no longer exist.

### 6. Security and verification

- [ ] Enforce object-level job permissions.
- [ ] Strengthen password validation and add auth/mutation rate limits.
- [ ] Use private signed object URLs for uploads.
- [ ] Test login, CRUD, PDFs, uploads, payments, receipts, and restoration on
  a Vercel Preview environment.

### 7. Release

- [ ] Provision Neon, Vercel Blob and Upstash in Vercel Marketplace.
- [ ] Configure Development, Preview and Production environment variables.
- [ ] Run the Postgres baseline migration (plus the Telegram/NAS-removal
  migration), import production data, and verify.
- [ ] Deploy to the production domain and monitor health, errors, and spend.

## External Actions Requiring Account Access

These actions cannot be completed from the repository alone:

1. Create/connect a GitHub repository.
2. Create Vercel project and connect its Git repository.
3. Provision Neon PostgreSQL, Vercel Blob, and Upstash Redis.
4. Add production and preview secrets in Vercel.
5. Configure domain DNS and approve production deployment.

## Acceptance Criteria

- No production dependency on a Pi, SQLite, local uploads, a local NAS
  mount, or a Telegram bot.
- All application data is in Postgres; uploaded files are private Blob
  objects.
- Workers can access the app over HTTPS from any browser.
- A restart or scale-out does not invalidate all sessions.
- Database migrations, backup/restoration and rollback procedures are written
  and rehearsed in Preview before production cutover.
