-- AlterEnum
ALTER TYPE "entry_source" ADD VALUE 'LATE_FEE';

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lateFeePercentagePpm" INTEGER;

-- CreateTable
CREATE TABLE "late_fee_charges" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "late_fee_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "late_fee_charges_journalEntryId_key" ON "late_fee_charges"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "late_fee_charges_invoiceId_key" ON "late_fee_charges"("invoiceId");

-- AddForeignKey
ALTER TABLE "late_fee_charges" ADD CONSTRAINT "late_fee_charges_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_charges" ADD CONSTRAINT "late_fee_charges_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every business that predates this migration is missing the new
-- system "Late Fee Income" account (4910) that coa-template.ts now seeds for
-- new businesses. Insert it for existing ones so late fees work without a
-- re-seed. Skips any business that already has a 4910 code (idempotent).
INSERT INTO "accounts" ("id", "businessId", "code", "name", "type", "subtype", "isSystem", "isArchived", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, b."id", '4910', 'Late Fee Income', 'INCOME', 'late_fee_income', true, false, now(), now()
FROM "businesses" b
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."businessId" = b."id" AND a."code" = '4910'
);
