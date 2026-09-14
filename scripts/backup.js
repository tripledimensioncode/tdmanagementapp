// ─────────────────────────────────────────────────────────────────────────
// LEGACY / LOCAL-DEV ONLY. This script backs up the old local SQLite file
// (prisma/data/triple.db) and the old local public/uploads/ folder. Neither
// of those is where production data lives anymore — the app now runs on
// Neon PostgreSQL + Vercel Blob (see prisma/schema.prisma's datasource and
// utils/storage.js). This script is a no-op against that setup and will
// simply tell you so.
//
// For real production backup/restore, see docs/restoration-runbook.md:
//   - Database: Neon's point-in-time recovery (branch from any timestamp
//     in the last 7-30 days, no separate backup job needed).
//   - Files: export objects from Vercel Blob's "uploads/" prefix.
//
// This script still works for a genuine local-dev setup that has been
// pointed at a local SQLite file (DATABASE_URL="file:...") for offline
// testing — that's the only case it's useful for now.
// ─────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const dbPath = path.join(rootDir, 'prisma', 'data', 'triple.db');
const uploadsPath = path.join(rootDir, 'public', 'uploads');
const backupsRoot = path.join(rootDir, 'backups');

function assertLocalSqliteSetup() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) {
    throw new Error(
      'DATABASE_URL is not a local SQLite file (it looks like a Postgres connection ' +
      'string, or is unset). This script only knows how to back up/restore the old ' +
      'local SQLite + local-disk setup, which is not what production uses anymore. ' +
      'See docs/restoration-runbook.md for the real backup/restore path ' +
      '(Neon point-in-time recovery + Vercel Blob export).'
    );
  }
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function getTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function createUniqueBackupDir() {
  await fs.mkdir(backupsRoot, { recursive: true });

  const baseName = getTimestamp();
  let candidate = path.join(backupsRoot, baseName);
  let i = 1;

  while (await pathExists(candidate)) {
    candidate = path.join(backupsRoot, `${baseName}_${pad(i)}`);
    i += 1;
  }

  await fs.mkdir(candidate, { recursive: true });
  return candidate;
}

function resolveBackupDir(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }

  const fromRoot = path.resolve(rootDir, trimmed);
  return fromRoot;
}

function printUsage() {
  console.log('Usage:');
  console.log('  node scripts/backup.js backup');
  console.log('  node scripts/backup.js restore backups/<folder-name>');
}

async function runBackup() {
  assertLocalSqliteSetup();
  if (!(await pathExists(dbPath))) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  const backupDir = await createUniqueBackupDir();
  const backupDbPath = path.join(backupDir, 'triple.db');
  const backupUploadsPath = path.join(backupDir, 'uploads');

  await fs.copyFile(dbPath, backupDbPath);

  if (await pathExists(uploadsPath)) {
    await fs.cp(uploadsPath, backupUploadsPath, { recursive: true });
  } else {
    await fs.mkdir(backupUploadsPath, { recursive: true });
    console.warn('[backup] uploads directory was missing; created empty uploads backup folder.');
  }

  console.log('[backup] Backup created successfully.');
  console.log(`[backup] Folder: ${backupDir}`);
  console.log(`[backup] Database: ${backupDbPath}`);
  console.log(`[backup] Uploads: ${backupUploadsPath}`);
}

async function runRestore(backupArg) {
  assertLocalSqliteSetup();
  const backupDir = resolveBackupDir(backupArg);
  if (!backupDir) {
    throw new Error('Missing backup folder argument.');
  }

  const sourceDbPath = path.join(backupDir, 'triple.db');
  const sourceUploadsPath = path.join(backupDir, 'uploads');

  if (!(await pathExists(sourceDbPath))) {
    throw new Error(`Backup database not found: ${sourceDbPath}`);
  }
  if (!(await pathExists(sourceUploadsPath))) {
    throw new Error(`Backup uploads folder not found: ${sourceUploadsPath}`);
  }

  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.copyFile(sourceDbPath, dbPath);

  await fs.mkdir(path.dirname(uploadsPath), { recursive: true });
  await fs.rm(uploadsPath, { recursive: true, force: true });
  await fs.cp(sourceUploadsPath, uploadsPath, { recursive: true });

  console.log('[restore] Restore completed successfully.');
  console.log(`[restore] Database restored to: ${dbPath}`);
  console.log(`[restore] Uploads restored to: ${uploadsPath}`);
}

async function main() {
  const command = (process.argv[2] || '').trim().toLowerCase();

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  if (command === 'backup') {
    await runBackup();
    return;
  }

  if (command === 'restore') {
    const backupArg = process.argv.slice(3).join(' ');
    await runRestore(backupArg);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(`[backup.js] ${err.message}`);
  printUsage();
  process.exit(1);
});
