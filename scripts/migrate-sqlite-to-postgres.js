/**
 * RETIRED — this app no longer has any SQLite, Raspberry Pi, Telegram, or
 * NAS code path to migrate from or to. The one-time SQLite → Postgres data
 * import this script used to perform is long finished (see
 * docs/vercel-migration-plan.md), and the Telegram/NAS tables it used to
 * copy no longer exist in prisma/schema.prisma — they were dropped along
 * with the Telegram bot and local NAS storage feature.
 *
 * This file is kept only as an inert placeholder because this deployment
 * cannot delete files from the repository. It intentionally does nothing.
 * If you are restoring from an old SQLite file for some other reason, do
 * not use this script — write a fresh one against the current schema.
 */

console.log('[migrate-sqlite-to-postgres] This script is retired and does nothing.');
console.log('Telegram, NAS, and Pi/SQLite support have been removed from this app.');
process.exit(0);
