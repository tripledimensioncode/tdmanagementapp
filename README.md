# TRIPLE DIMENSION

Workshop management web app for TRIPLE DIMENSION FABRICATION WORKS, built with
Node.js, Express, EJS, and Prisma — hosted entirely on Vercel, backed by Neon
PostgreSQL, Vercel Blob (private file storage), and Upstash Redis
(sessions + rate limiting).

This app has no Telegram bot, no Raspberry Pi (or any other self-hosted
machine) in its deployment, and no local NAS/USB-drive storage. Those were
all part of an earlier, retired architecture; everything now runs as a
single Vercel serverless function with no separate always-on process and no
local file storage anywhere. This README reflects that current state. For
disaster recovery, see
[docs/restoration-runbook.md](./docs/restoration-runbook.md).

## What Is In This Repo

- Session-based authentication with `ADMIN` and `WORKER` roles, admin-only
  registration with an audit log, and a 3-admin-quorum full system reset
- Fabrication job tracking: CRUD, file attachments, PDF invoices, payment
  installments + PDF receipts, CSV/XLSX export, admin-managed service types
- Inventory tracking with categories, departments, and photos
- Funds / cashbook: deposits, withdrawals, admin-reviewed funding requests
- Subscribers (workshop memberships): unique codes, PDF ID cards with QR
  codes, activity log
- Customer (CRM) tracking for potential and existing customers
- Attendance check-in/check-out (personal + admin view)
- Daily log / task tracking ("My Day")
- Team status updates and admin-authored assessments
- Analytics dashboards (time, money, filament usage, funding requests)

## Tech Stack

- Runtime: Node.js 20
- Server: Express 4, hosted as a single Vercel serverless function
  (`api/index.js` → `app.js`)
- Views: EJS + `express-ejs-layouts`
- Database: Neon Serverless PostgreSQL
- ORM: Prisma 4
- File storage: Vercel Blob (private access), proxied through `/files/open`
- Sessions & rate limiting: Upstash Redis (falls back to in-memory stores
  when `REDIS_URL` is unset, for local dev only)
- Auth: `express-session` + `bcrypt`
- CSRF: a small custom session-backed module (`utils/csrf.js`)
- Uploads: `multer` (memory storage in the cloud, disk storage as a local
  fallback)
- PDF generation: `pdfkit` + `qrcode`
- Styling: Tailwind CDN + a small custom stylesheet

## Project Structure

```text
triple-dimension/
|-- app.js                  # Express app: middleware + route mounting
|-- server.js                # Local dev entry point (app.listen)
|-- api/index.js             # Vercel serverless function entry point
|-- vercel.json               # Rewrites every path to api/index.js
|-- prisma/
|   |-- schema.prisma         # Postgres datasource, ~24 models
|   `-- migrations/           # 0_init is the baseline; later folders layer on top
|-- routes/                   # One file per module, mounted in app.js
|-- middleware/                # auth.js, flash.js, security.js
|-- utils/                     # storage.js (Blob), upload.js, pdf.js,
|                               # billing.js, csrf.js, helpers.js
|-- views/                     # EJS templates, one folder per module
|-- public/                    # css/js/images (+ uploads/ as a local-dev
|                               # fallback only)
|-- scripts/                   # Ops scripts — see "Available npm Scripts"
|-- docs/                      # Deployment, migration, and DR docs
`-- .github/workflows/deploy.yml
```

## Data Model (Prisma)

`prisma/schema.prisma` has ~24 models, grouped roughly by module:

- **Auth / audit**: `User`, `AccountCreationLog`, `SystemResetRequest`,
  `SystemResetApproval`
- **Fabrication**: `Fabrication`, `FabricationFile`, `FabricationLineItem`,
  `FabricationPayment`, `Service`
- **Inventory**: `InventoryItem`, `InventoryCategory`, `InventoryDepartment`
- **Funds**: `FundTransaction`, `FundingRequest`
- **Subscribers**: `Subscriber`, `SubscriptionType`, `SubscriberActivity`
- **Customers**: `Customer`
- **Attendance / daily log**: `AttendanceRecord`, `DailyLog`, `WorkTask`
- **Team updates / assessments**: `WorkUpdate`, `AssessmentTemplate`,
  `AssessmentResponse`

## Access Control Summary

- `WORKER`
  - Log in; check in/out; set their daily log and tasks
  - Create and view fabrication jobs, record payments, generate invoices
  - Read inventory; view and post team updates; respond to assessments
  - Manage customers (create/edit/call/toggle) and subscribers (create,
    log activities)
- `ADMIN`
  - All worker permissions, plus:
  - Register users, view the account creation audit log, change any
    password
  - Add/update/delete inventory items, categories, and departments
  - Delete fabrication jobs; manage service types
  - Delete customers and subscribers
  - Review funding requests; manage subscription types
  - Author assessment templates
  - Approve/execute a full system reset (requires 3 distinct admins)

## Route Overview

- `/` — dashboard, `/api/active-jobs` — live active-jobs polling
- `/auth/*` — login, logout, admin-only registration, password change,
  account logs, system reset
- `/fabrication/*` — jobs, files, invoices, payments, receipts, services
- `/inventory/*` — items, categories, departments
- `/funds/*` — cashbook, funding requests, CSV/XLSX export
- `/subscribers/*` — memberships, ID cards, activity log
- `/customers/*` — CRM
- `/attendance/*` — check-in/out, admin view
- `/my-day/*` — daily log + tasks
- `/work-updates/*` — team status board
- `/assessments/*` — admin templates + worker responses
- `/analytics/*` — dashboards + JSON APIs
- `/files/*` — authenticated proxy for private Blob objects

## Quick Start

### Prerequisites

- Node.js 20+
- npm
- A Postgres database to develop against — a local Postgres instance or a
  Neon branch both work. **A local SQLite file will not work**: the Prisma
  datasource is Postgres-only.

### Setup

```powershell
npm install
Copy-Item .env.example .env
# edit .env: set DATABASE_URL / DIRECT_URL to a real Postgres connection string
npx prisma generate
npx prisma migrate deploy
node scripts/seed.js
npm run dev
```

Open `http://localhost:3000`.

Demo accounts created by the seed script:

- Admin: `admin@local` / `adminpass`
- Worker: `worker@local` / `workerpass`

## Environment Variables

See `.env.example` for the full list with sample values. The essentials:

```env
DATABASE_URL="postgresql://...pooler.../neondb?sslmode=require"
DIRECT_URL="postgresql://.../neondb?sslmode=require"
SESSION_SECRET=change_this_to_a_strong_random_value
REDIS_URL="rediss://..."
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."
COOKIE_SECURE=1
TRUST_PROXY=1
```

Notes:

- `REDIS_URL` and `BLOB_READ_WRITE_TOKEN` can be left unset for local dev —
  sessions fall back to in-memory storage and uploads fall back to local
  disk under `public/uploads/`. Both **must** be set in production.
- `COOKIE_SECURE=1` / `TRUST_PROXY=1` are required behind Vercel's
  HTTPS-terminating proxy; use `0`/`0` for local plain-HTTP dev.

## Available npm Scripts

- `npm start` — run server normally
- `npm run dev` — run with nodemon
- `npm run prisma:generate` — generate Prisma client
- `npm run prisma:migrate` — create/apply a migration in dev
- `npm run prisma:consolidate-migrations` — one-off: removes legacy
  SQLite-dialect migration folders, leaving only the `0_init` Postgres
  baseline (see `docs/vercel-migration-plan.md`)
- `npm run seed` — seed demo data
- `npm run backup` / `npm run restore` — **legacy, local-dev only**: backs
  up/restores an old local SQLite file + local uploads folder. Not useful
  against production — see [Backups](#backups) below.

## Backups

Production data lives in Neon PostgreSQL and Vercel Blob, not in any local
file — so the real backup/restore path is:

- **Database**: Neon's continuous point-in-time recovery (branch from any
  timestamp in the last 7–30 days; no separate backup job to run).
- **Files**: export objects from Vercel Blob's `uploads/` prefix.

Full steps are in [docs/restoration-runbook.md](./docs/restoration-runbook.md).

`scripts/backup.js` (`npm run backup` / `npm run restore`) still exists but
only knows how to back up an old local SQLite file + local uploads
folder — it refuses to run unless `DATABASE_URL` is a local `file:` path,
and is only useful if you're doing genuinely offline local-dev testing
against SQLite-shaped local data.

## Current Implementation Notes

- Global CSRF protection is enabled in `app.js`; forms must include
  `_csrf`.
- File uploads go through `utils/storage.js`: Vercel Blob in production,
  local disk under `public/uploads/` as a dev fallback.
- Flash messages are session-backed via `middleware/flash.js`.
- No automated test suite is configured in `package.json`.

## Security Notes

- Change `SESSION_SECRET` before any deployment — there's a hardcoded
  fallback in `app.js` for local dev convenience, but it must not be relied
  on anywhere real.
- The app is internet-facing on Vercel: HTTPS is terminated at the edge,
  sessions are Redis-backed, login is rate-limited, and CSRF protection is
  on for all form submissions.
- Keep `BLOB_READ_WRITE_TOKEN`, `DATABASE_URL`/`DIRECT_URL`, and
  `REDIS_URL` out of version control — they're already covered by
  `.gitignore` via `.env`.

## License

MIT
