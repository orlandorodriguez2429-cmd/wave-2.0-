-- CreateEnum
CREATE TYPE "email_kind" AS ENUM ('INVOICE_REMINDER');

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "kind" "email_kind" NOT NULL,
    "relatedInvoiceId" TEXT,
    "providerName" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_messages_businessId_relatedInvoiceId_sentAt_idx" ON "email_messages"("businessId", "relatedInvoiceId", "sentAt");

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_relatedInvoiceId_fkey" FOREIGN KEY ("relatedInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
