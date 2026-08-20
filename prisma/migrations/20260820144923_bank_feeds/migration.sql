-- CreateEnum
CREATE TYPE "bank_connection_status" AS ENUM ('ACTIVE', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "imported_txn_status" AS ENUM ('PENDING', 'CATEGORIZED', 'MATCHED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "rule_match_type" AS ENUM ('CONTAINS', 'REGEX');

-- CreateEnum
CREATE TYPE "rule_direction" AS ENUM ('INFLOW', 'OUTFLOW', 'BOTH');

-- CreateEnum
CREATE TYPE "reconciliation_status" AS ENUM ('OPEN', 'COMPLETED');

-- CreateTable
CREATE TABLE "bank_connections" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "status" "bank_connection_status" NOT NULL DEFAULT 'ACTIVE',
    "accessTokenEncrypted" TEXT,
    "syncCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_account_links" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mask" TEXT,
    "currency" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,

    CONSTRAINT "bank_account_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_transactions" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "bankAccountLinkId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "imported_txn_status" NOT NULL DEFAULT 'PENDING',
    "journalEntryId" TEXT,
    "matchedJournalLineId" TEXT,
    "suggestedAccountId" TEXT,
    "suggestedByRuleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorization_rules" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "matchType" "rule_match_type" NOT NULL DEFAULT 'CONTAINS',
    "appliesTo" "rule_direction" NOT NULL DEFAULT 'BOTH',
    "accountId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorization_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_sessions" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "statementStart" DATE NOT NULL,
    "statementEnd" DATE NOT NULL,
    "startingBalance" BIGINT NOT NULL,
    "endingBalance" BIGINT NOT NULL,
    "status" "reconciliation_status" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_account_links_connectionId_externalAccountId_key" ON "bank_account_links"("connectionId", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "imported_transactions_journalEntryId_key" ON "imported_transactions"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "imported_transactions_matchedJournalLineId_key" ON "imported_transactions"("matchedJournalLineId");

-- CreateIndex
CREATE INDEX "imported_transactions_businessId_status_idx" ON "imported_transactions"("businessId", "status");

-- CreateIndex
CREATE INDEX "imported_transactions_bankAccountLinkId_date_idx" ON "imported_transactions"("bankAccountLinkId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "imported_transactions_bankAccountLinkId_externalId_key" ON "imported_transactions"("bankAccountLinkId", "externalId");

-- CreateIndex
CREATE INDEX "categorization_rules_businessId_priority_idx" ON "categorization_rules"("businessId", "priority");

-- CreateIndex
CREATE INDEX "reconciliation_sessions_businessId_status_idx" ON "reconciliation_sessions"("businessId", "status");

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account_links" ADD CONSTRAINT "bank_account_links_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "bank_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_bankAccountLinkId_fkey" FOREIGN KEY ("bankAccountLinkId") REFERENCES "bank_account_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_sessions" ADD CONSTRAINT "reconciliation_sessions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
