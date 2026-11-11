-- Phase B: automatic month-to-month cycle (auto-categorization, months, statement uploads).


-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "booksStartDate" DATE,
ADD COLUMN     "businessType" TEXT;

-- AlterTable
ALTER TABLE "categorization_rules" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "imported_transactions" ADD COLUMN     "aiConfidence" DOUBLE PRECISION,
ADD COLUMN     "aiReason" TEXT,
ADD COLUMN     "autoProcessedAt" TIMESTAMP(3),
ADD COLUMN     "categorizedBy" TEXT,
ADD COLUMN     "statementUploadId" TEXT;

-- CreateTable
CREATE TABLE "statement_uploads" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "bankAccountLinkId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "openingBalance" BIGINT NOT NULL,
    "closingBalance" BIGINT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "statement_uploads_businessId_createdAt_idx" ON "statement_uploads"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "statement_uploads" ADD CONSTRAINT "statement_uploads_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Rows already on the books were categorized by a person.
UPDATE "imported_transactions" SET "categorizedBy" = 'USER' WHERE "status" IN ('CATEGORIZED', 'MATCHED');
