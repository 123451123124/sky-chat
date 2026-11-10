-- DropIndex
DROP INDEX "Chunk_documentId_ordinal_key";

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "activeGenerationId" TEXT,
ADD COLUMN     "pendingGenerationId" TEXT;

-- AlterTable
ALTER TABLE "Chunk" ADD COLUMN     "generationId" TEXT;

-- CreateTable
CREATE TABLE "RagGeneration" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "stage" TEXT NOT NULL DEFAULT 'parse',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagStage" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "errorCode" TEXT,
    "lastError" TEXT,
    "durationMs" INTEGER,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RagStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagOutbox" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "RagOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagDeadLetter" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "errorCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replayedAt" TIMESTAMP(3),

    CONSTRAINT "RagDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagVectorCache" (
    "userId" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "vector" BYTEA NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagVectorCache_pkey" PRIMARY KEY ("userId","profile","hash")
);

-- CreateTable
CREATE TABLE "RagIndexCleanup" (
    "generationId" TEXT NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagIndexCleanup_pkey" PRIMARY KEY ("generationId")
);

-- CreateIndex
CREATE INDEX "RagGeneration_documentId_createdAt_idx" ON "RagGeneration"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "RagGeneration_status_updatedAt_idx" ON "RagGeneration"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RagStage_generationId_stage_key" ON "RagStage"("generationId", "stage");

-- CreateIndex
CREATE INDEX "RagOutbox_status_availableAt_idx" ON "RagOutbox"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "RagDeadLetter_eventId_key" ON "RagDeadLetter"("eventId");

-- CreateIndex
CREATE INDEX "RagDeadLetter_generationId_createdAt_idx" ON "RagDeadLetter"("generationId", "createdAt");

-- CreateIndex
CREATE INDEX "RagVectorCache_expiresAt_idx" ON "RagVectorCache"("expiresAt");

-- CreateIndex
CREATE INDEX "Chunk_generationId_idx" ON "Chunk"("generationId");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_documentId_generationId_ordinal_key" ON "Chunk"("documentId", "generationId", "ordinal");

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "RagGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagGeneration" ADD CONSTRAINT "RagGeneration_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagStage" ADD CONSTRAINT "RagStage_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "RagGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagOutbox" ADD CONSTRAINT "RagOutbox_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "RagGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagDeadLetter" ADD CONSTRAINT "RagDeadLetter_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "RagGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Chunk_legacy_document_ordinal" ON "Chunk" ("documentId", ordinal) WHERE "generationId" IS NULL;
ALTER TABLE "RagVectorCache" ADD CONSTRAINT "RagVectorCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RagGeneration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RagStage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RagOutbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RagDeadLetter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RagVectorCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RagIndexCleanup" ENABLE ROW LEVEL SECURITY;
