-- Reversão manual de 20261119170000_automacoes_genericas (Fase 3a). Correr só depois de voltar o código.
-- Perde-se: o histórico de execuções. As regras voltam à forma antiga (só as de negócios existiam antes).
-- Não se desfazem (ensaiado): o passo das regras «campo alterado» (era ignorado nesse gatilho) e a desativação das
-- regras «campo alterado» sem operador (nunca disparavam). O comportamento antigo é o mesmo com ou sem eles.
BEGIN;
DROP TABLE "AutomationRun";
DROP TYPE "AutomationRunOutcome";
DROP INDEX "AutomationRule_entityType_trigger_active_idx";

CREATE TYPE "AutomationTriggerType" AS ENUM ('STAGE_IDLE_TIME', 'TASK_COMPLETED', 'FIELD_CHANGED');
CREATE TYPE "AutomationActionType" AS ENUM ('MOVE_STAGE', 'TRIGGER_WEBHOOK');
ALTER TABLE "AutomationRule" ADD COLUMN "triggerType" "AutomationTriggerType";
ALTER TABLE "AutomationRule" ADD COLUMN "actionType" "AutomationActionType";
UPDATE "AutomationRule" SET
  "triggerType" = (CASE "trigger" WHEN 'IDLE_IN_STEP' THEN 'STAGE_IDLE_TIME' WHEN 'ALL_TASKS_CLOSED' THEN 'TASK_COMPLETED' ELSE "trigger" END)::"AutomationTriggerType",
  "actionType" = (CASE "action" WHEN 'MOVE_TO_STEP' THEN 'MOVE_STAGE' WHEN 'WEBHOOK' THEN 'TRIGGER_WEBHOOK' ELSE "action" END)::"AutomationActionType";
-- «Campo alterado»: a primeira condição volta para dentro do gatilho.
UPDATE "AutomationRule" SET "triggerConfig" = "triggerConfig" || jsonb_build_object('operator', "conditions"->0->'operator', 'value', "conditions"->0->'value')
WHERE "trigger" = 'FIELD_CHANGED' AND jsonb_array_length("conditions") > 0;
UPDATE "AutomationRule" SET "actionConfig" = ("actionConfig" - 'targetStepId') || jsonb_build_object('targetStageId', "actionConfig"->'targetStepId')
WHERE "action" = 'MOVE_TO_STEP' AND jsonb_exists("actionConfig", 'targetStepId');
ALTER TABLE "AutomationRule" ALTER COLUMN "triggerType" SET NOT NULL;
ALTER TABLE "AutomationRule" ALTER COLUMN "actionType" SET NOT NULL;
ALTER TABLE "AutomationRule" DROP COLUMN "trigger", DROP COLUMN "action", DROP COLUMN "conditions", DROP COLUMN "entityType";
ALTER TABLE "AutomationRule" ALTER COLUMN "triggerConfig" DROP DEFAULT;
ALTER TABLE "AutomationRule" ALTER COLUMN "actionConfig" DROP DEFAULT;
CREATE INDEX "AutomationRule_triggerType_active_idx" ON "AutomationRule"("triggerType", "active");

ALTER INDEX "AutomationRule_workflowId_idx" RENAME TO "AutomationRule_pipelineId_idx";
ALTER INDEX "AutomationRule_stepId_idx" RENAME TO "AutomationRule_stageId_idx";
ALTER TABLE "AutomationRule" RENAME CONSTRAINT "AutomationRule_workflowId_fkey" TO "AutomationRule_pipelineId_fkey";
ALTER TABLE "AutomationRule" RENAME CONSTRAINT "AutomationRule_stepId_fkey" TO "AutomationRule_stageId_fkey";
ALTER TABLE "AutomationRule" RENAME COLUMN "workflowId" TO "pipelineId";
ALTER TABLE "AutomationRule" RENAME COLUMN "stepId" TO "stageId";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261119170000_automacoes_genericas';
COMMIT;
