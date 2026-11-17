-- REVERSÃO MANUAL do pacote 0c (prisma/migrations/20261117170000_fluxos_genericos). NÃO é aplicada automaticamente.
-- Usar só se for preciso voltar ao código anterior ao 0c, DEPOIS de uma cópia de segurança:
--   psql "$DATABASE_URL" -f prisma/rollbacks/20261117170000_fluxos_genericos.down.sql
--   psql "$DATABASE_URL" -c "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20261117170000_fluxos_genericos';"
-- Perde informação que o modelo antigo não tinha: as categorias IN_PROGRESS e CANCELLED passam a OPEN. Fluxos de
-- outros tipos que não DEAL não cabem no modelo antigo: a reversão recusa-se se existirem.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Workflow" WHERE "entityType" <> 'DEAL') THEN
    RAISE EXCEPTION 'Existem fluxos que não são de negócios; a reversão perderia dados';
  END IF;
END $$;

CREATE TYPE "StageType" AS ENUM ('OPEN', 'WON', 'LOST');
ALTER TABLE "WorkflowStep" ADD COLUMN "type" "StageType" NOT NULL DEFAULT 'OPEN';
UPDATE "WorkflowStep" SET "type" = CASE
  WHEN "outcome" = 'WON' THEN 'WON'::"StageType"
  WHEN "outcome" = 'LOST' THEN 'LOST'::"StageType"
  ELSE 'OPEN'::"StageType" END;
ALTER TABLE "WorkflowStep" DROP CONSTRAINT "WorkflowStep_outcome_only_done";
ALTER TABLE "WorkflowStep" DROP COLUMN "category";
ALTER TABLE "WorkflowStep" DROP COLUMN "outcome";
DROP TYPE "WorkflowStepCategory";
DROP TYPE "WorkflowOutcome";

ALTER INDEX "WorkflowStep_workflowId_idx" RENAME TO "Stage_pipelineId_idx";
ALTER TABLE "WorkflowStep" RENAME CONSTRAINT "WorkflowStep_workflowId_fkey" TO "Stage_pipelineId_fkey";
ALTER TABLE "WorkflowStep" RENAME COLUMN "workflowId" TO "pipelineId";
ALTER TABLE "WorkflowStep" RENAME CONSTRAINT "WorkflowStep_pkey" TO "Stage_pkey";
ALTER TABLE "WorkflowStep" RENAME TO "Stage";

DROP INDEX "Workflow_entityType_idx";
ALTER TABLE "Workflow" DROP COLUMN "entityType";
ALTER TABLE "Workflow" RENAME CONSTRAINT "Workflow_pkey" TO "Pipeline_pkey";
ALTER TABLE "Workflow" RENAME TO "Pipeline";

COMMIT;
