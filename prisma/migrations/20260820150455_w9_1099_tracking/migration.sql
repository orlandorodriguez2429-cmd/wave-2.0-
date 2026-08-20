-- CreateEnum
CREATE TYPE "tax_entity_type" AS ENUM ('INDIVIDUAL_SOLE_PROP', 'C_CORP', 'S_CORP', 'PARTNERSHIP', 'TRUST_ESTATE', 'LLC_C', 'LLC_S', 'LLC_P', 'OTHER');

-- CreateEnum
CREATE TYPE "tin_type" AS ENUM ('SSN', 'EIN');

-- CreateEnum
CREATE TYPE "w9_status" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "vendor_payment_source" AS ENUM ('EXPENSE', 'MANUAL');

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "backupWithholding" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "defaultBoxCode" TEXT NOT NULL DEFAULT 'NEC_1',
ADD COLUMN     "eDeliveryConsentAt" TIMESTAMP(3),
ADD COLUMN     "is1099Eligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "taxCity" TEXT,
ADD COLUMN     "taxEntityType" "tax_entity_type",
ADD COLUMN     "taxState" TEXT,
ADD COLUMN     "taxStreet" TEXT,
ADD COLUMN     "taxZip" TEXT,
ADD COLUMN     "tinEncrypted" TEXT,
ADD COLUMN     "tinLast4" TEXT,
ADD COLUMN     "tinType" "tin_type",
ADD COLUMN     "w9CompletedAt" TIMESTAMP(3),
ADD COLUMN     "w9FileId" TEXT,
ADD COLUMN     "w9RequestToken" TEXT,
ADD COLUMN     "w9RequestedAt" TIMESTAMP(3),
ADD COLUMN     "w9Status" "w9_status" NOT NULL DEFAULT 'NOT_REQUESTED';

-- CreateTable
CREATE TABLE "vendor_payments" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" "payment_method" NOT NULL,
    "boxCode" TEXT NOT NULL DEFAULT 'NEC_1',
    "source" "vendor_payment_source" NOT NULL DEFAULT 'MANUAL',
    "expenseId" TEXT,
    "memo" TEXT,
    "excludedFrom1099" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_year_configs" (
    "taxYear" INTEGER NOT NULL,
    "necMiscThreshold" BIGINT NOT NULL,
    "intThreshold" BIGINT NOT NULL,
    "divThreshold" BIGINT NOT NULL,
    "efileMandateCount" INTEGER NOT NULL DEFAULT 10,
    "notes" TEXT,

    CONSTRAINT "tax_year_configs_pkey" PRIMARY KEY ("taxYear")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payments_expenseId_key" ON "vendor_payments"("expenseId");

-- CreateIndex
CREATE INDEX "vendor_payments_vendorId_date_idx" ON "vendor_payments"("vendorId", "date");

-- CreateIndex
CREATE INDEX "vendor_payments_businessId_date_idx" ON "vendor_payments"("businessId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_w9RequestToken_key" ON "vendors"("w9RequestToken");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_w9FileId_key" ON "vendors"("w9FileId");

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

