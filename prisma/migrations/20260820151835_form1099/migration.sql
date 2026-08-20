-- CreateEnum
CREATE TYPE "form1099_status" AS ENUM ('DRAFT', 'READY', 'SUBMITTED', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "einEncrypted" TEXT,
ADD COLUMN     "einLast4" TEXT,
ADD COLUMN     "taxCity" TEXT,
ADD COLUMN     "taxState" TEXT,
ADD COLUMN     "taxStreet" TEXT,
ADD COLUMN     "taxZip" TEXT;

-- CreateTable
CREATE TABLE "form1099s" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "formKind" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "form1099_status" NOT NULL DEFAULT 'DRAFT',
    "correctsId" TEXT,
    "amounts" JSONB NOT NULL,
    "payer" JSONB NOT NULL,
    "recipient" JSONB NOT NULL,
    "transmitter" TEXT,
    "submissionId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "copyBDeliveredAt" TIMESTAMP(3),
    "copyBDeliveryMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form1099s_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "form1099s_correctsId_key" ON "form1099s"("correctsId");

-- CreateIndex
CREATE INDEX "form1099s_businessId_taxYear_status_idx" ON "form1099s"("businessId", "taxYear", "status");

-- CreateIndex
CREATE UNIQUE INDEX "form1099s_businessId_vendorId_taxYear_formKind_version_key" ON "form1099s"("businessId", "vendorId", "taxYear", "formKind", "version");

-- AddForeignKey
ALTER TABLE "form1099s" ADD CONSTRAINT "form1099s_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "form1099s"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form1099s" ADD CONSTRAINT "form1099s_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

