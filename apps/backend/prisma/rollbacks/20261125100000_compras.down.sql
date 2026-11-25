-- Reversão manual de 20261125100000_compras (Fase 6c). Correr só depois de voltar o código.
-- Perde-se: todas as compras e as linhas, a timeline das compras e a ligação das tarefas às encomendas (as tarefas
-- ficam). Os movimentos de stock das receções ficam (o livro de stock só acrescenta), com a origem a apontar para uma
-- compra que já não existe. O tipo «Preparar encomenda» só sai se nenhuma tarefa o usar.
BEGIN;
DELETE FROM "TimelineEvent" WHERE "entityType" = 'PURCHASE_ORDER';
DROP TABLE "PurchaseOrderLine";
DROP TABLE "PurchaseOrder";
DROP FUNCTION "purchase_order_texto_pesquisa"();
DROP TYPE "PurchaseOrderStatus";
ALTER TABLE "WorkItem" DROP COLUMN "salesOrderId";
ALTER TABLE "SalesOrder" DROP COLUMN "preparationTaskAt";
DELETE FROM "WorkItemType" t
  WHERE t."id" = 'PREPARAR_ENCOMENDA' AND t."isSystem" AND NOT EXISTS (SELECT 1 FROM "WorkItem" w WHERE w."typeId" = t."id");
-- Tirar 'PURCHASE_ORDER' do enum da timeline: recriar o tipo sem esse valor.
ALTER TYPE "TimelineEntityType" RENAME TO "TimelineEntityType_old";
CREATE TYPE "TimelineEntityType" AS ENUM ('COMPANY', 'CONTACT', 'LEAD', 'DEAL', 'TASK', 'ORDER');
ALTER TABLE "TimelineEvent" ALTER COLUMN "entityType" TYPE "TimelineEntityType" USING "entityType"::text::"TimelineEntityType";
DROP TYPE "TimelineEntityType_old";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261125100000_compras';
COMMIT;
