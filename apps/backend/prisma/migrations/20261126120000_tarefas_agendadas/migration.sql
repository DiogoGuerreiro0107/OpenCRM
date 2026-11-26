-- CreateEnum
CREATE TYPE "ScheduledJobRunStatus" AS ENUM ('SUCCESS', 'FAILED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "ScheduledJobTrigger" AS ENUM ('SCHEDULE', 'MANUAL');

-- CreateTable
CREATE TABLE "ScheduledJobState" (
    "jobId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pausedAt" TIMESTAMP(3),
    "pausedReason" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJobState_pkey" PRIMARY KEY ("jobId")
);

-- CreateTable
CREATE TABLE "ScheduledJobRun" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "trigger" "ScheduledJobTrigger" NOT NULL,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledJobRunStatus" NOT NULL,
    "summary" TEXT,
    "error" TEXT,

    CONSTRAINT "ScheduledJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledJobRun_jobId_startedAt_idx" ON "ScheduledJobRun"("jobId", "startedAt");

-- CreateIndex
CREATE INDEX "ScheduledJobRun_startedAt_idx" ON "ScheduledJobRun"("startedAt");

-- AddForeignKey
ALTER TABLE "ScheduledJobRun" ADD CONSTRAINT "ScheduledJobRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Fase E1.2: as falhas seguidas nunca são negativas.
ALTER TABLE "ScheduledJobState" ADD CONSTRAINT "ScheduledJobState_falhas" CHECK ("consecutiveFailures" >= 0);
