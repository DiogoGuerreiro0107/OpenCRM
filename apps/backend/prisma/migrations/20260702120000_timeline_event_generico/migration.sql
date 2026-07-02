-- Revisao "TimelineEvent generico": substitui o ActivityLog (fixo a Contact/Company)
-- por um modelo polimorfico reutilizavel por Company/Contact/Lead/Deal/Task,
-- conforme CLAUDE.md.

-- CreateEnum
CREATE TYPE "TimelineEntityType" AS ENUM ('COMPANY', 'CONTACT', 'LEAD', 'DEAL', 'TASK');

-- Reaproveita o enum ActivityType (mesmos valores) em vez de criar um novo do zero.
ALTER TYPE "ActivityType" RENAME TO "TimelineEventType";
ALTER TYPE "TimelineEventType" ADD VALUE 'SYSTEM';

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "entityType" "TimelineEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TimelineEventType" NOT NULL DEFAULT 'NOTE',
    "title" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimelineEvent_entityType_entityId_idx" ON "TimelineEvent"("entityType", "entityId");

-- Migrar dados existentes do ActivityLog (associado a Contact ou Company) para TimelineEvent.
INSERT INTO "TimelineEvent" ("id", "entityType", "entityId", "userId", "type", "title", "description", "createdAt")
SELECT
  "id",
  CASE WHEN "contactId" IS NOT NULL THEN 'CONTACT'::"TimelineEntityType" ELSE 'COMPANY'::"TimelineEntityType" END,
  COALESCE("contactId", "companyId"),
  "authorId",
  "type",
  NULL,
  "content",
  "createdAt"
FROM "ActivityLog"
WHERE "contactId" IS NOT NULL OR "companyId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropTable (remove tambem as suas constraints/indices automaticamente)
DROP TABLE "ActivityLog";
