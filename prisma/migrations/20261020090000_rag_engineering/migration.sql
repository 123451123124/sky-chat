-- AlterTable
ALTER TABLE "KnowledgeBase" ADD COLUMN     "chunkingStrategy" TEXT NOT NULL DEFAULT 'recursive',
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'public';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "familyId" TEXT,
ADD COLUMN     "ingestionMetrics" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pipelineProfile" TEXT,
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "replacesId" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'inherit';

-- AlterTable
ALTER TABLE "Chunk" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'leaf',
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "searchText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "searchText")) STORED,
ADD COLUMN     "textHash" TEXT;

-- AlterTable
ALTER TABLE "IngestionJob" ADD COLUMN     "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "lastError" TEXT;

-- CreateTable
CREATE TABLE "AccessGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "AccessGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupClosure" (
    "ancestorId" TEXT NOT NULL,
    "descendantId" TEXT NOT NULL,

    CONSTRAINT "GroupClosure_pkey" PRIMARY KEY ("ancestorId","descendantId")
);

-- CreateTable
CREATE TABLE "GroupMembership" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("userId","groupId")
);

-- CreateTable
CREATE TABLE "KnowledgeGroupGrant" (
    "knowledgeBaseId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "KnowledgeGroupGrant_pkey" PRIMARY KEY ("knowledgeBaseId","groupId")
);

-- CreateTable
CREATE TABLE "DocumentGroupGrant" (
    "documentId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "DocumentGroupGrant_pkey" PRIMARY KEY ("documentId","groupId")
);

-- CreateTable
CREATE TABLE "DocumentUserGrant" (
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "DocumentUserGrant_pkey" PRIMARY KEY ("documentId","userId")
);

-- CreateTable
CREATE TABLE "EmbeddingCache" (
    "userId" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmbeddingCache_pkey" PRIMARY KEY ("userId","profile","hash")
);

-- CreateTable
CREATE TABLE "IngestionCheckpoint" (
    "documentId" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionCheckpoint_pkey" PRIMARY KEY ("documentId")
);

-- CreateIndex
CREATE INDEX "AccessGroup_parentId_idx" ON "AccessGroup"("parentId");

-- CreateIndex
CREATE INDEX "GroupClosure_descendantId_idx" ON "GroupClosure"("descendantId");

-- CreateIndex
CREATE INDEX "EmbeddingCache_expiresAt_idx" ON "EmbeddingCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_familyId_revision_key" ON "Document"("familyId", "revision");

-- CreateIndex
CREATE INDEX "Chunk_parentId_idx" ON "Chunk"("parentId");

-- CreateIndex
CREATE INDEX "IngestionJob_status_availableAt_idx" ON "IngestionJob"("status", "availableAt");

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Chunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGroup" ADD CONSTRAINT "AccessGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AccessGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupClosure" ADD CONSTRAINT "GroupClosure_ancestorId_fkey" FOREIGN KEY ("ancestorId") REFERENCES "AccessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupClosure" ADD CONSTRAINT "GroupClosure_descendantId_fkey" FOREIGN KEY ("descendantId") REFERENCES "AccessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGroupGrant" ADD CONSTRAINT "KnowledgeGroupGrant_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGroupGrant" ADD CONSTRAINT "KnowledgeGroupGrant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGroupGrant" ADD CONSTRAINT "DocumentGroupGrant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGroupGrant" ADD CONSTRAINT "DocumentGroupGrant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentUserGrant" ADD CONSTRAINT "DocumentUserGrant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentUserGrant" ADD CONSTRAINT "DocumentUserGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbeddingCache" ADD CONSTRAINT "EmbeddingCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionCheckpoint" ADD CONSTRAINT "IngestionCheckpoint_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing private/public behavior and document identities are preserved.
UPDATE "Document" SET "familyId" = id WHERE "familyId" IS NULL;
ALTER TABLE "Document" ALTER COLUMN "familyId" SET NOT NULL;
CREATE INDEX "Chunk_searchVector_gin" ON "Chunk" USING GIN ("searchVector");
ALTER TABLE "AccessGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupClosure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeGroupGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentGroupGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentUserGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmbeddingCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IngestionCheckpoint" ENABLE ROW LEVEL SECURITY;
