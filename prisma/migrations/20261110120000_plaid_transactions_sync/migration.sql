-- Phase A: real Plaid adapter with /transactions/sync.

-- Connection status: DISCONNECTED becomes REMOVED (renamed in place so any
-- existing rows keep their meaning), plus a needs-reconnect state.
ALTER TYPE "bank_connection_status" RENAME VALUE 'DISCONNECTED' TO 'REMOVED';
ALTER TYPE "bank_connection_status" ADD VALUE 'NEEDS_RECONNECT';

-- Connections: Plaid item identity, sync cursor, webhook/sync bookkeeping.
ALTER TABLE "bank_connections"
  ADD COLUMN "itemId" TEXT,
  ADD COLUMN "institutionId" TEXT,
  ADD COLUMN "cursor" TEXT,
  ADD COLUMN "syncRequestedAt" TIMESTAMP(3),
  ADD COLUMN "lastWebhookAt" TIMESTAMP(3),
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "removedAt" TIMESTAMP(3),
  ADD COLUMN "createdById" TEXT;

-- The mock feed's old integer cursor carries over into the new text cursor,
-- so existing sandbox connections don't re-deliver batches.
UPDATE "bank_connections" SET "cursor" = "syncCount"::text
  WHERE "provider" = 'mock' AND "syncCount" > 0;
ALTER TABLE "bank_connections" DROP COLUMN "syncCount";

CREATE UNIQUE INDEX "bank_connections_itemId_key" ON "bank_connections"("itemId");

-- Account links: Plaid type/subtype (mask stays last-4 only).
ALTER TABLE "bank_account_links"
  ADD COLUMN "type" TEXT,
  ADD COLUMN "subtype" TEXT;

-- Imported transactions: provider hints + post-posting change flags.
ALTER TABLE "imported_transactions"
  ADD COLUMN "merchantName" TEXT,
  ADD COLUMN "providerCategory" TEXT,
  ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewReason" TEXT,
  ADD COLUMN "providerChange" JSONB,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "imported_transactions_businessId_needsReview_idx"
  ON "imported_transactions"("businessId", "needsReview");
