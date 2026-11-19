-- Fase 3a (docs/plano-fase-3-automacoes.md): motor de automações genérico. Renomeia sem copiar dados e converte as
-- regras existentes para a forma nova com o MESMO comportamento. Reversão:
-- prisma/rollbacks/20261119170000_automacoes_genericas.down.sql.

-- 1. Âmbito: funil/fase -> fluxo/passo (os ids já são de Workflow/WorkflowStep desde a 0c).
ALTER TABLE "AutomationRule" RENAME COLUMN "pipelineId" TO "workflowId";
ALTER TABLE "AutomationRule" RENAME COLUMN "stageId" TO "stepId";
ALTER TABLE "AutomationRule" RENAME CONSTRAINT "AutomationRule_pipelineId_fkey" TO "AutomationRule_workflowId_fkey";
ALTER TABLE "AutomationRule" RENAME CONSTRAINT "AutomationRule_stageId_fkey" TO "AutomationRule_stepId_fkey";
ALTER INDEX "AutomationRule_pipelineId_idx" RENAME TO "AutomationRule_workflowId_idx";
ALTER INDEX "AutomationRule_stageId_idx" RENAME TO "AutomationRule_stepId_idx";
DROP INDEX "AutomationRule_triggerType_active_idx";

-- 2. Tipo de registo, gatilho e ação em texto (validados pelos registos do código) e condições genéricas.
ALTER TABLE "AutomationRule" ADD COLUMN "entityType" TEXT NOT NULL DEFAULT 'DEAL';
ALTER TABLE "AutomationRule" ADD COLUMN "conditions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "AutomationRule" ADD COLUMN "trigger" TEXT;
ALTER TABLE "AutomationRule" ADD COLUMN "action" TEXT;
UPDATE "AutomationRule" SET
  "trigger" = CASE "triggerType"::text WHEN 'STAGE_IDLE_TIME' THEN 'IDLE_IN_STEP' WHEN 'TASK_COMPLETED' THEN 'ALL_TASKS_CLOSED' ELSE "triggerType"::text END,
  "action" = CASE "actionType"::text WHEN 'MOVE_STAGE' THEN 'MOVE_TO_STEP' WHEN 'TRIGGER_WEBHOOK' THEN 'WEBHOOK' ELSE "actionType"::text END;
ALTER TABLE "AutomationRule" ALTER COLUMN "trigger" SET NOT NULL;
ALTER TABLE "AutomationRule" ALTER COLUMN "action" SET NOT NULL;
ALTER TABLE "AutomationRule" DROP COLUMN "triggerType";
ALTER TABLE "AutomationRule" DROP COLUMN "actionType";
DROP TYPE "AutomationTriggerType";
DROP TYPE "AutomationActionType";

-- 3. «Campo alterado»: a condição sai do gatilho para a lista de condições (o gatilho fica só com o campo). O passo era
--    ignorado neste gatilho: limpa-se, para continuar a não restringir. Uma regra sem campo ou sem operador nunca
--    disparava: fica desativada (continua a não fazer nada, agora à vista).
UPDATE "AutomationRule" SET
  "conditions" = jsonb_build_array(jsonb_build_object('field', "triggerConfig"->'field', 'operator', "triggerConfig"->'operator', 'value', "triggerConfig"->'value')),
  "triggerConfig" = jsonb_build_object('field', "triggerConfig"->'field'),
  "stepId" = NULL
WHERE "trigger" = 'FIELD_CHANGED' AND jsonb_exists("triggerConfig", 'field') AND jsonb_exists("triggerConfig", 'operator');
UPDATE "AutomationRule" SET "active" = false, "stepId" = NULL
WHERE "trigger" = 'FIELD_CHANGED' AND jsonb_array_length("conditions") = 0;

-- 4. Mover: a fase de destino passa a passo de destino.
UPDATE "AutomationRule" SET "actionConfig" = ("actionConfig" - 'targetStageId') || jsonb_build_object('targetStepId', "actionConfig"->'targetStageId')
WHERE "action" = 'MOVE_TO_STEP' AND jsonb_exists("actionConfig", 'targetStageId');

ALTER TABLE "AutomationRule" ALTER COLUMN "triggerConfig" SET DEFAULT '{}';
ALTER TABLE "AutomationRule" ALTER COLUMN "actionConfig" SET DEFAULT '{}';
CREATE INDEX "AutomationRule_entityType_trigger_active_idx" ON "AutomationRule"("entityType", "trigger", "active");

-- 5. Histórico de execuções.
CREATE TYPE "AutomationRunOutcome" AS ENUM ('SUCCEEDED', 'SKIPPED', 'FAILED');
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "outcome" "AutomationRunOutcome" NOT NULL,
    "message" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AutomationRun_createdAt_id_idx" ON "AutomationRun"("createdAt", "id");
CREATE INDEX "AutomationRun_ruleId_createdAt_idx" ON "AutomationRun"("ruleId", "createdAt");
CREATE INDEX "AutomationRun_entityType_entityId_idx" ON "AutomationRun"("entityType", "entityId");
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
