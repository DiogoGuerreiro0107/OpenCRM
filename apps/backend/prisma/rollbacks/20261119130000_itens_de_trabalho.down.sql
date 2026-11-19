-- REVERSÃO MANUAL do pacote 2a (prisma/migrations/20261119130000_itens_de_trabalho). NÃO é aplicada automaticamente.
-- Usar só se for preciso voltar ao código anterior ao 2a, DEPOIS de uma cópia de segurança:
--   psql "$DATABASE_URL" -f prisma/rollbacks/20261119130000_itens_de_trabalho.down.sql
-- Perde informação que o modelo antigo não tinha: os itens de tipos personalizados (e de «Tarefa») ficam sem tipo, e
-- os cancelados passam a concluídos. Também apaga a linha da migração em _prisma_migrations.
BEGIN;

CREATE TYPE "TaskType" AS ENUM ('CHAMADA', 'EMAIL', 'VISITA', 'PROPOSTA', 'COBRANCA', 'ASSISTENCIA', 'OUTRO');
ALTER TABLE "WorkItem" ADD COLUMN "type" "TaskType";
UPDATE "WorkItem" SET "type" = "typeId"::"TaskType"
  WHERE "typeId" IN ('CHAMADA', 'EMAIL', 'VISITA', 'PROPOSTA', 'COBRANCA', 'ASSISTENCIA', 'OUTRO');
ALTER TABLE "WorkItem" DROP CONSTRAINT "WorkItem_typeId_fkey";
DROP INDEX "WorkItem_typeId_idx";
ALTER TABLE "WorkItem" DROP COLUMN "typeId";
DROP TABLE "WorkItemType";

-- Estado: um enum não perde valores; recria-se sem CANCELLED.
UPDATE "WorkItem" SET "status" = 'DONE' WHERE "status" = 'CANCELLED';
ALTER TABLE "WorkItem" ALTER COLUMN "status" DROP DEFAULT;
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE');
ALTER TABLE "WorkItem" ALTER COLUMN "status" TYPE "TaskStatus" USING "status"::text::"TaskStatus";
ALTER TABLE "WorkItem" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "WorkItemStatus";
ALTER TYPE "WorkItemPriority" RENAME TO "TaskPriority";

ALTER INDEX "Reminder_workItemId_idx" RENAME TO "Reminder_taskId_idx";
ALTER TABLE "Reminder" RENAME CONSTRAINT "Reminder_workItemId_fkey" TO "Reminder_taskId_fkey";
ALTER TABLE "Reminder" RENAME COLUMN "workItemId" TO "taskId";

ALTER FUNCTION "work_item_colunas_derivadas"() RENAME TO "task_colunas_derivadas";
ALTER TRIGGER "WorkItem_colunas_derivadas" ON "WorkItem" RENAME TO "Task_colunas_derivadas";
ALTER INDEX "WorkItem_dueSort_createdAt_id_idx" RENAME TO "Task_dueSort_createdAt_id_idx";
ALTER INDEX "WorkItem_searchText_idx" RENAME TO "Task_searchText_idx";
ALTER INDEX "WorkItem_dueDate_idx" RENAME TO "Task_dueDate_idx";
ALTER INDEX "WorkItem_assigneeId_idx" RENAME TO "Task_assigneeId_idx";
ALTER TABLE "WorkItem" RENAME CONSTRAINT "WorkItem_leadId_fkey" TO "Task_leadId_fkey";
ALTER TABLE "WorkItem" RENAME CONSTRAINT "WorkItem_dealId_fkey" TO "Task_dealId_fkey";
ALTER TABLE "WorkItem" RENAME CONSTRAINT "WorkItem_companyId_fkey" TO "Task_companyId_fkey";
ALTER TABLE "WorkItem" RENAME CONSTRAINT "WorkItem_contactId_fkey" TO "Task_contactId_fkey";
ALTER TABLE "WorkItem" RENAME CONSTRAINT "WorkItem_assigneeId_fkey" TO "Task_assigneeId_fkey";
ALTER TABLE "WorkItem" RENAME CONSTRAINT "WorkItem_pkey" TO "Task_pkey";
ALTER TABLE "WorkItem" RENAME TO "Task";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261119130000_itens_de_trabalho';

COMMIT;
