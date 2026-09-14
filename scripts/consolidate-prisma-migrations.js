#!/usr/bin/env node
/**
 * Consolidates prisma/migrations down to the single Postgres-native baseline.
 *
 * Why this exists
 * ----------------
 * This project's migration history is a leftover from the SQLite → Postgres
 * move: `prisma/migrations/0_init/` is a clean, complete, Postgres-flavored
 * baseline that already creates every table in the current schema.prisma —
 * but sitting next to it are 16 older migration folders that are still
 * written in SQLite DDL (`AUTOINCREMENT`, `DATETIME`, `REAL`, ...), even
 * though `migration_lock.toml` locks this whole folder to
 * `provider = "postgresql"`. Those SQLite-dialect folders are invalid SQL
 * against Postgres and must never be applied there — see
 * docs/vercel-migration-plan.md, which already says as much.
 *
 * Because "0_init" sorts before the older, date-named folders, a
 * `prisma migrate deploy` against a genuinely FRESH Postgres database
 * (a new Preview branch, a new developer's local DB, a disaster-recovery
 * rebuild that isn't a Neon PITR branch) applies 0_init first — creating
 * every table — and then immediately fails on the next folder, which tries
 * to CREATE TABLE "User" again with invalid Postgres syntax. This script
 * removes that trap by deleting every migration folder except 0_init,
 * leaving a single, valid, Postgres-only migration history.
 *
 * This does NOT touch your database — it only changes what's on disk in
 * prisma/migrations/. See the printed instructions at the end for the one
 * thing you still need to verify against your actual production database.
 *
 * Usage:
 *   node scripts/consolidate-prisma-migrations.js            # dry run (default) — lists what would be removed
 *   node scripts/consolidate-prisma-migrations.js --yes       # actually deletes the legacy folders
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

// Explicit list of the 16 legacy SQLite-dialect migration folders left over
// from the pre-Postgres era. This is intentionally an explicit allowlist
// rather than "everything except 0_init" — any valid Postgres migration
// folder added after 0_init (like the Telegram/NAS-removal migration dated
// 2026-09-14) must be kept, not swept up as if it were more legacy cruft.
const LEGACY_FOLDERS = new Set([
  '20251226155457_init',
  '20260303161705_init',
  '20260303195348_fabrication_pdf_invoicing',
  '20260303201116_user_print_rate_default',
  '20260303210146_funds_module',
  '20260303215150_account_creation_audit',
  '20260315112700_add_subscribers',
  '20260620034152_v2_upgrade',
  '20260620184335_inventory_categories_departments',
  '20260621164313_inventory_image',
  '20260626015151_multi_admin_reset',
  '20260627200435_nas_folder_system',
  '20260702084109_add_fabrication_line_items',
  '20260702113525_add_fabrication_project_name',
  '20260907220000_telegram_and_payment_receipts',
  '20260907221000_telegram_update_idempotency'
]);

function main() {
  const apply = process.argv.includes('--yes') || process.argv.includes('-y');

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`No migrations directory found at ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  const legacyFolders = entries
    .filter((e) => e.isDirectory() && LEGACY_FOLDERS.has(e.name))
    .map((e) => e.name)
    .sort();

  if (!entries.some((e) => e.isDirectory() && e.name === '0_init')) {
    console.error(
      'Refusing to continue: prisma/migrations/0_init was not found. ' +
      'This script only knows how to consolidate around that baseline — ' +
      'if your migrations folder looks different now, do this by hand instead.'
    );
    process.exit(1);
  }

  if (legacyFolders.length === 0) {
    console.log('Nothing to do — prisma/migrations already contains only 0_init.');
    return;
  }

  console.log(`${apply ? 'Removing' : '[DRY RUN] Would remove'} ${legacyFolders.length} legacy SQLite-dialect migration folder(s):\n`);
  for (const name of legacyFolders) {
    console.log(`  - ${name}`);
    if (apply) {
      fs.rmSync(path.join(MIGRATIONS_DIR, name), { recursive: true, force: true });
    }
  }

  console.log('');
  if (!apply) {
    console.log('This was a dry run — nothing was deleted. Re-run with --yes to actually remove these folders.');
    return;
  }

  console.log('Done. prisma/migrations now contains only 0_init plus any migration folders');
  console.log('dated after it (plus migration_lock.toml) — the legacy SQLite-dialect folders');
  console.log('are gone.');
  console.log('');
  console.log('──────────────────────────────────────────────────────────────────────────');
  console.log('IMPORTANT — one thing to verify against your PRODUCTION database before your');
  console.log('next deploy (this script cannot check this for you — it never connects to a');
  console.log('database):');
  console.log('');
  console.log('  npx prisma migrate status   # run with your production DATABASE_URL/DIRECT_URL');
  console.log('');
  console.log('Production almost certainly already has every table from 0_init (it\'s the live');
  console.log('app). What matters is whether Prisma\'s own bookkeeping table');
  console.log('(_prisma_migrations) already records "0_init" as applied:');
  console.log('');
  console.log('  * If `migrate status` reports the database is up to date (or only shows the');
  console.log('    legacy migration names, now missing locally, as already applied) — you\'re');
  console.log('    done, nothing else to do. Removing local folders for migrations already');
  console.log('    recorded as applied never causes Prisma to re-run or undo them.');
  console.log('');
  console.log('  * If `migrate status` shows "0_init" as PENDING (not yet applied) — do NOT run');
  console.log('    `prisma migrate deploy` yet, since 0_init would try to CREATE TABLE for');
  console.log('    tables that already exist and fail. Instead, tell Prisma it\'s already there:');
  console.log('');
  console.log('      npx prisma migrate resolve --applied 0_init');
  console.log('');
  console.log('    Then `npx prisma migrate status` again to confirm it now reports up to date.');
  console.log('──────────────────────────────────────────────────────────────────────────');
}

main();
