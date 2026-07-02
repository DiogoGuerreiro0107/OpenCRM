-- Automatismos entre funis/fases, a pedido do utilizador (fora do roadmap original).

-- AlterTable: rastreio de quando um negocio entrou na fase atual, para a
-- regra de "tempo parado numa fase". Valores existentes ficam com o
-- momento da migracao (nao ha historico anterior para recuperar).
ALTER TABLE "Deal" ADD COLUMN "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('STAGE_IDLE_TIME', 'TASK_COMPLETED', 'FIELD_CHANGED');

-- CreateEnum
CREATE TYPE "AutomationActionType" AS ENUM ('MOVE_STAGE', 'TRIGGER_WEBHOOK');

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pipelineId" TEXT,
    "stageId" TEXT,
    "triggerType" "AutomationTriggerType" NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "actionType" "AutomationActionType" NOT NULL,
    "actionConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_pipelineId_idx" ON "AutomationRule"("pipelineId");

-- CreateIndex
CREATE INDEX "AutomationRule_stageId_idx" ON "AutomationRule"("stageId");

-- CreateIndex
CREATE INDEX "AutomationRule_triggerType_active_idx" ON "AutomationRule"("triggerType", "active");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
