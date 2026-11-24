-- Reversão manual de 20261124150000_encomendas (Fase 6a). Correr só depois de voltar o código.
-- Perde-se: todas as encomendas, as linhas, a timeline das encomendas e os campos personalizados de encomendas.
BEGIN;
DELETE FROM "TimelineEvent" WHERE "entityType" = 'ORDER';
DELETE FROM "CustomFieldValue" WHERE "entityType" = 'ORDER';
DELETE FROM "CustomField" WHERE "entityType" = 'ORDER';
DROP TABLE "SalesOrderLine";
DROP TABLE "SalesOrder";
DROP FUNCTION "sales_order_texto_pesquisa"();
DROP TYPE "SalesOrderStatus";
-- Tirar 'ORDER' do enum da timeline: recriar o tipo sem esse valor.
ALTER TYPE "TimelineEntityType" RENAME TO "TimelineEntityType_old";
CREATE TYPE "TimelineEntityType" AS ENUM ('COMPANY', 'CONTACT', 'LEAD', 'DEAL', 'TASK');
ALTER TABLE "TimelineEvent" ALTER COLUMN "entityType" TYPE "TimelineEntityType" USING "entityType"::text::"TimelineEntityType";
DROP TYPE "TimelineEntityType_old";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261124150000_encomendas';
COMMIT;
