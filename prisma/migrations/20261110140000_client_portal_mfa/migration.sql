-- Phase C/D: CLIENT role, TOTP MFA + backup codes, invites, rate limits, lockout, session versions, deletion records.


-- AlterEnum
ALTER TYPE "membership_role" ADD VALUE 'CLIENT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN     "mfaLastStep" INTEGER,
ADD COLUMN     "mfaSecretEncrypted" TEXT,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "mfa_backup_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "mfa_backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "membership_role" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "deletion_records" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "deletedById" TEXT NOT NULL,
    "plaidItemsRemoved" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mfa_backup_codes_userId_idx" ON "mfa_backup_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "invites_tokenHash_key" ON "invites"("tokenHash");

-- CreateIndex
CREATE INDEX "invites_businessId_createdAt_idx" ON "invites"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "mfa_backup_codes" ADD CONSTRAINT "mfa_backup_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

