-- One-time backfill: record a cashbook DEPOSIT for every job payment that was
-- taken before job payments were linked to Funds. Skips any payment that
-- already has a linked deposit, so it can never double count.
INSERT INTO "FundTransaction" ("type", "amount", "title", "description", "reference", "date", "createdById", "fabricationPaymentId")
SELECT
  'DEPOSIT',
  p."amount",
  'Job #' || f."id" || ' payment: ' || f."name",
  p."method" || COALESCE(' - ' || p."notes", ''),
  p."reference",
  p."paidAt",
  p."receivedById",
  p."id"
FROM "FabricationPayment" p
JOIN "Fabrication" f ON f."id" = p."fabricationId"
WHERE NOT EXISTS (
  SELECT 1 FROM "FundTransaction" t WHERE t."fabricationPaymentId" = p."id"
);
