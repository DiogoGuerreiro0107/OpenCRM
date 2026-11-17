-- Pacote 0c (docs/plano-fase-0-fundacoes.md): funis e fases passam a fluxos genéricos.
-- RENOMEIA (não copia): os ids não mudam, por isso negócios e regras de automação continuam a apontar para os
-- mesmos registos. Tudo numa transação: ou corre toda, ou nada muda.
-- Reversão (não aplicada automaticamente): prisma/rollbacks/20261117170000_fluxos_genericos.down.sql
BEGIN;

-- 1. Pipeline -> Workflow
ALTER TABLE "Pipeline" RENAME TO "Workflow";
ALTER TABLE "Workflow" RENAME CONSTRAINT "Pipeline_pkey" TO "Workflow_pkey";
ALTER TABLE "Workflow" ADD COLUMN "entityType" TEXT NOT NULL DEFAULT 'DEAL';
ALTER TABLE "Workflow" ALTER COLUMN "entityType" DROP DEFAULT;
CREATE INDEX "Workflow_entityType_idx" ON "Workflow"("entityType");

-- 2. Stage -> WorkflowStep (pipelineId -> workflowId)
ALTER TABLE "Stage" RENAME TO "WorkflowStep";
ALTER TABLE "WorkflowStep" RENAME CONSTRAINT "Stage_pkey" TO "WorkflowStep_pkey";
ALTER TABLE "WorkflowStep" RENAME COLUMN "pipelineId" TO "workflowId";
ALTER TABLE "WorkflowStep" RENAME CONSTRAINT "Stage_pipelineId_fkey" TO "WorkflowStep_workflowId_fkey";
ALTER INDEX "Stage_pipelineId_idx" RENAME TO "WorkflowStep_workflowId_idx";

-- 3. type (OPEN/WON/LOST) -> category + outcome
CREATE TYPE "WorkflowStepCategory" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');
CREATE TYPE "WorkflowOutcome" AS ENUM ('WON', 'LOST');
ALTER TABLE "WorkflowStep" ADD COLUMN "category" "WorkflowStepCategory" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "WorkflowStep" ADD COLUMN "outcome" "WorkflowOutcome";

UPDATE "WorkflowStep" SET
  "category" = CASE "type" WHEN 'OPEN' THEN 'OPEN'::"WorkflowStepCategory" ELSE 'DONE'::"WorkflowStepCategory" END,
  "outcome"  = CASE "type" WHEN 'WON' THEN 'WON'::"WorkflowOutcome" WHEN 'LOST' THEN 'LOST'::"WorkflowOutcome" ELSE NULL END;

-- Verificação: aborta (e desfaz tudo) se alguma fase não tiver sido convertida exatamente como previsto.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "WorkflowStep" WHERE
      ("type" = 'OPEN' AND ("category" <> 'OPEN' OR "outcome" IS NOT NULL)) OR
      ("type" = 'WON'  AND ("category" <> 'DONE' OR "outcome" IS DISTINCT FROM 'WON')) OR
      ("type" = 'LOST' AND ("category" <> 'DONE' OR "outcome" IS DISTINCT FROM 'LOST'))
  ) THEN
    RAISE EXCEPTION 'Fluxos genéricos: conversão de fases inconsistente; migração anulada';
  END IF;
END $$;

ALTER TABLE "WorkflowStep" DROP COLUMN "type";
DROP TYPE "StageType";

-- Um resultado (ganho/perdido) só faz sentido num passo concluído.
ALTER TABLE "WorkflowStep" ADD CONSTRAINT "WorkflowStep_outcome_only_done" CHECK ("outcome" IS NULL OR "category" = 'DONE');

COMMIT;
