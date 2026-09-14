# Triple Dimension Disaster Recovery & Restoration Runbook

This document outlines the step-by-step procedures for disaster recovery, environment configuration, database restoration via Neon Point-in-Time Recovery (PITR), and Vercel Blob asset exports.

---

## 1. System Architecture Summary

- **App Server**: Vercel Node.js Serverless Functions (`api/index.js` -> `app.js`)
- **Database**: Neon Serverless PostgreSQL with Prisma ORM
- **Blob Storage**: Vercel Blob (Private Storage)
- **Sessions & Throttling**: Upstash Redis

This app has no Telegram bot, no Raspberry Pi or other self-hosted machine
in its deployment, and no local NAS/USB-drive storage — it runs entirely on
Vercel with no local file archive of any kind.

---

## 2. Health Monitoring & Alerts

- **Health Check Endpoint**: `https://app.tripledimension.com/health`
- **Uptime Monitoring**: Configured via Better Stack / Pingdom checking `/health` every 60 seconds.
- **Budget Alerts**: Set monthly spending limits in Vercel, Neon, Upstash, and Vercel Blob consoles.

---

## 3. Database Point-in-Time Recovery (PITR)

Neon automatically maintains Continuous Write-Ahead Log (WAL) backups allowing instant restoration to any second in the past 7 to 30 days.

### Restoration Steps (Postgres):

1. **Identify Recovery Timestamp**:
   Determine the exact UTC timestamp before the data corruption or issue occurred.

2. **Branch Database in Neon**:
   In the Neon Console (or via Neon CLI), create a restore branch from production:
   ```bash
   neon branch create restore-branch --parent main --timestamp "2026-09-08T12:00:00Z"
   ```

3. **Verify Restored Data**:
   Connect via `psql` or Prisma to the `restore-branch` connection string and
   spot-check row counts on key tables (`User`, `Fabrication`,
   `FundTransaction`, etc.). `scripts/migrate-sqlite-to-postgres.js` is
   retired and no longer usable for this — it was a one-time SQLite import
   tool, not a verification tool.

4. **Promote Branch or Swap Connection Strings**:
   - Update Vercel production environment variables `DATABASE_URL` and `DIRECT_URL` to point to the restored Neon connection string.
   - Trigger a new deployment in Vercel to pick up the updated database credentials.

---

## 4. Vercel Blob Asset Restoration & Backup

### Exporting Files from Vercel Blob:
1. Use the `@vercel/blob` SDK CLI or admin export utility to list and download all objects tagged in the `uploads/` prefix.
2. Store cold offsite archives of high-value fabrication files (STL, STEP, 3MF, PDFs) wherever your organization keeps long-term backups (e.g. a cloud storage bucket) — this app no longer has a local NAS to archive to.

---

## 5. Local Development Fallback & Emergency Rollback

If cloud infrastructure is temporarily unreachable:

1. Copy latest SQLite backup `prisma/data/triple.db` locally.
2. Update `.env`:
   ```env
   DATABASE_URL="file:./data/triple.db"
   ```
3. Run local server:
   ```bash
   npm run dev
   ```
   The local application will launch on `http://localhost:3000` using local memory sessions and local filesystem uploads.
