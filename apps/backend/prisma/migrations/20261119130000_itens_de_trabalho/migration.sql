-- Fase 2a (docs/plano-fase-2-itens-de-trabalho.md): Task → WorkItem, tipos configuráveis (WorkItemType) e estado
-- «cancelada». Renomeia sem copiar dados: os ids mantêm-se, e lembretes, ligações e timeline continuam a apontar
-- para os mesmos registos. Reversão: prisma/rollbacks/20261119130000_itens_de_trabalho.down.sql.

-- Enums
ALTER TYPE "TaskStatus" RENAME TO "WorkItemStatus";
ALTER TYPE "WorkItemStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "TaskPriority" RENAME TO "WorkItemPriority";

-- Tabela, chaves, índices e trigger
ALTER TABLE "Task" RENAME TO "WorkItem";
ALTER TABLE "WorkItem" RENAME CONSTRAINT "Task_pkey" TO "WorkItem_pkey";
ALTER TABLE "WorkItem" RENAME CONSTRAINT "Task_assigneeId_fkey" TO "WorkItem_assigneeId_fkey";
ALTER TABLE "WorkItem" RENAME CONSTRAINT "Task_contactId_fkey" TO "WorkItem_contactId_fkey";
ALTER TABLE "WorkItem" RENAME CONSTRAINT "Task_companyId_fkey" TO "WorkItem_companyId_fkey";
ALTER TABLE "WorkItem" RENAME CONSTRAINT "Task_dealId_fkey" TO "WorkItem_dealId_fkey";
ALTER TABLE "WorkItem" RENAME CONSTRAINT "Task_leadId_fkey" TO "WorkItem_leadId_fkey";
ALTER INDEX "Task_assigneeId_idx" RENAME TO "WorkItem_assigneeId_idx";
ALTER INDEX "Task_dueDate_idx" RENAME TO "WorkItem_dueDate_idx";
ALTER INDEX "Task_searchText_idx" RENAME TO "WorkItem_searchText_idx";
ALTER INDEX "Task_dueSort_createdAt_id_idx" RENAME TO "WorkItem_dueSort_createdAt_id_idx";
ALTER TRIGGER "Task_colunas_derivadas" ON "WorkItem" RENAME TO "WorkItem_colunas_derivadas";
ALTER FUNCTION "task_colunas_derivadas"() RENAME TO "work_item_colunas_derivadas";

-- Lembretes
ALTER TABLE "Reminder" RENAME COLUMN "taskId" TO "workItemId";
ALTER TABLE "Reminder" RENAME CONSTRAINT "Reminder_taskId_fkey" TO "Reminder_workItemId_fkey";
ALTER INDEX "Reminder_taskId_idx" RENAME TO "Reminder_workItemId_idx";

-- Tipos (o id é o código estável). Os mesmos de src/work-item-types/system-types.ts.
CREATE TABLE "WorkItemType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItemType_pkey" PRIMARY KEY ("id")
);

INSERT INTO "WorkItemType" ("id", "name", "icon", "color", "isSystem", "sortOrder", "updatedAt") VALUES
    ('TAREFA', 'Tarefa', 'check-square', 'slate', true, 0, CURRENT_TIMESTAMP),
    ('CHAMADA', 'Chamada', 'phone', 'blue', true, 1, CURRENT_TIMESTAMP),
    ('EMAIL', 'Email', 'mail', 'violet', true, 2, CURRENT_TIMESTAMP),
    ('VISITA', 'Visita', 'map-pin', 'green', true, 3, CURRENT_TIMESTAMP),
    ('PROPOSTA', 'Proposta', 'file-text', 'amber', true, 4, CURRENT_TIMESTAMP),
    ('COBRANCA', 'Cobrança', 'banknote', 'red', true, 5, CURRENT_TIMESTAMP),
    ('ASSISTENCIA', 'Assistência', 'wrench', 'teal', true, 6, CURRENT_TIMESTAMP),
    ('OUTRO', 'Outro', 'circle-dot', 'gray', true, 7, CURRENT_TIMESTAMP);

-- Expandir → migrar → contrair: cada item fica com o tipo que tinha (sem tipo → «Tarefa»).
ALTER TABLE "WorkItem" ADD COLUMN "typeId" TEXT NOT NULL DEFAULT 'TAREFA';
UPDATE "WorkItem" SET "typeId" = "type"::text WHERE "type" IS NOT NULL;
ALTER TABLE "WorkItem" DROP COLUMN "type";
DROP TYPE "TaskType";

CREATE INDEX "WorkItem_typeId_idx" ON "WorkItem"("typeId");
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "WorkItemType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
