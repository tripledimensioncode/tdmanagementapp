-- Remove Telegram bot support and local NAS storage support entirely.
--
-- This matches the corresponding removal in prisma/schema.prisma: the
-- TelegramAccount, TelegramLinkCode, TelegramJobDraft, TelegramProcessedUpdate,
-- NasCategory, NasFolder, and NasFile models are gone, along with every
-- foreign-key column that pointed at them (FabricationFile.nasFileId,
-- Subscriber.idCardNasFileId, SubscriberActivity.nasFileId). All statements
-- are IF EXISTS / idempotent-safe so this applies cleanly whether or not a
-- given target database already has some of these objects.

-- 1. Drop foreign-key columns on tables that are staying, but pointed at NasFile.
ALTER TABLE "FabricationFile" DROP CONSTRAINT IF EXISTS "FabricationFile_nasFileId_fkey";
ALTER TABLE "FabricationFile" DROP COLUMN IF EXISTS "nasFileId";

ALTER TABLE "Subscriber" DROP CONSTRAINT IF EXISTS "Subscriber_idCardNasFileId_fkey";
ALTER TABLE "Subscriber" DROP COLUMN IF EXISTS "idCardNasFileId";

ALTER TABLE "SubscriberActivity" DROP CONSTRAINT IF EXISTS "SubscriberActivity_nasFileId_fkey";
ALTER TABLE "SubscriberActivity" DROP COLUMN IF EXISTS "nasFileId";

-- 2. Drop Telegram tables (children before parents).
DROP TABLE IF EXISTS "TelegramJobDraft";
DROP TABLE IF EXISTS "TelegramLinkCode";
DROP TABLE IF EXISTS "TelegramAccount";
DROP TABLE IF EXISTS "TelegramProcessedUpdate";

-- 3. Drop NAS tables (children before parents).
DROP TABLE IF EXISTS "NasFile";
DROP TABLE IF EXISTS "NasFolder";
DROP TABLE IF EXISTS "NasCategory";
