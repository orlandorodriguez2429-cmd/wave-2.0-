-- CreateEnum
CREATE TYPE "bill_status" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "entry_source" ADD VALUE 'BILL';
ALTER TYPE "entry_source" ADD VALUE 'BILL_PAYMENT';

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "nextBillNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "bill_status" NOT NULL DEFAULT 'DRAFT',
    "billDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "memo" TEXT,
    "total" BIGINT NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "voidJournalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_lines" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT,
    "expenseAccountId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payments" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" "payment_method" NOT NULL,
    "memo" TEXT,
    "paymentAccountId" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bills_journalEntryId_key" ON "bills"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "bills_voidJournalEntryId_key" ON "bills"("voidJournalEntryId");

-- CreateIndex
CREATE INDEX "bills_businessId_status_idx" ON "bills"("businessId", "status");

-- CreateIndex
CREATE INDEX "bills_businessId_dueDate_idx" ON "bills"("businessId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "bills_businessId_number_key" ON "bills"("businessId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "bill_lines_billId_lineNo_key" ON "bill_lines"("billId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payments_journalEntryId_key" ON "bill_payments"("journalEntryId");

-- CreateIndex
CREATE INDEX "bill_payments_businessId_date_idx" ON "bill_payments"("businessId", "date");

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
