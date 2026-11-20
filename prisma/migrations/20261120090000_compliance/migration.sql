-- Terms/privacy acceptance, Safeguards Rule duties, incident log.
ALTER TABLE "users" ADD COLUMN "termsVersion" TEXT;
ALTER TABLE "users" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);

CREATE TABLE "compliance_events" (
    "id" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compliance_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "compliance_events_item_doneAt_idx" ON "compliance_events"("item", "doneAt");

CREATE TABLE "compliance_incidents" (
    "id" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "peopleAffected" INTEGER NOT NULL DEFAULT 0,
    "floridaResidents" INTEGER NOT NULL DEFAULT 0,
    "unencryptedData" BOOLEAN NOT NULL DEFAULT false,
    "containedAt" TIMESTAMP(3),
    "individualsNotifiedAt" TIMESTAMP(3),
    "ftcNotifiedAt" TIMESTAMP(3),
    "floridaAgNotifiedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "compliance_incidents_pkey" PRIMARY KEY ("id")
);
