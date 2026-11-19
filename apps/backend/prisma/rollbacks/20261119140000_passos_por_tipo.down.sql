-- Reversão manual de 20261119140000_passos_por_tipo (Fase 2b). Correr numa transação e só depois de voltar o código.
-- Perde-se: os passos dos itens, os fluxos dos tipos de tarefa (WORK_ITEM) e os campos personalizados de tarefas.
-- Falha (e nada muda) se dois campos de outro tipo de registo tiverem o mesmo nome em âmbitos diferentes.
BEGIN;
DROP TRIGGER "WorkItem_passo_coerente" ON "WorkItem";
DROP FUNCTION "work_item_passo_coerente"();

ALTER TABLE "WorkItem" DROP CONSTRAINT "WorkItem_stepId_fkey";
ALTER TABLE "WorkItemType" DROP CONSTRAINT "WorkItemType_workflowId_fkey";
DROP INDEX "WorkItem_stepId_idx";
DROP INDEX "WorkItemType_workflowId_key";
ALTER TABLE "WorkItem" DROP COLUMN "stepId";
ALTER TABLE "WorkItemType" DROP COLUMN "workflowId";
DELETE FROM "Workflow" WHERE "entityType" = 'WORK_ITEM';

DELETE FROM "CustomField" WHERE "entityType" = 'WORK_ITEM';
DROP INDEX "CustomField_entityType_scopeId_fieldName_key";
ALTER TABLE "CustomField" DROP COLUMN "scopeId";
CREATE UNIQUE INDEX "CustomField_entityType_fieldName_key" ON "CustomField"("entityType", "fieldName");

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261119140000_passos_por_tipo';
COMMIT;
