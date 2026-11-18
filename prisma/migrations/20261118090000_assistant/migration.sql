-- In-app chat assistant conversations (aliased/masked history + proposed actions).

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_conversations_userId_updatedAt_idx" ON "assistant_conversations"("userId", "updatedAt");

