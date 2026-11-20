-- Fase 4b (docs/plano-fase-4-assistencias.md): registo de tempo nos itens de trabalho.

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "runningUserId" TEXT,
    "note" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "editReason" TEXT,
    "editedAt" TIMESTAMP(3),
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_runningUserId_key" ON "TimeEntry"("runningUserId");

-- CreateIndex
CREATE INDEX "TimeEntry_workItemId_startedAt_idx" ON "TimeEntry"("workItemId", "startedAt");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_startedAt_idx" ON "TimeEntry"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Um só cronómetro a correr por pessoa: "runningUserId" (única) está preenchida se e só se o registo corre, e é o
-- utilizador do registo. O fim nunca é antes do início.
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_running_consistent"
  CHECK (("endedAt" IS NULL) = ("runningUserId" IS NOT NULL) AND ("runningUserId" IS NULL OR "runningUserId" = "userId"));
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_end_after_start"
  CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
