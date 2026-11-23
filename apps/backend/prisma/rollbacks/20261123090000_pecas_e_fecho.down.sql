-- Reversão manual de 20261123090000_pecas_e_fecho (Fase 4c). Correr só depois de voltar o código.
-- Perde-se: as peças usadas nas assistências e a hora de fecho dos itens de trabalho.
BEGIN;
DROP TRIGGER "WorkItem_fechado_em" ON "WorkItem";
DROP FUNCTION "work_item_fechado_em"();
DROP TABLE "ServicePart";
DROP INDEX "WorkItem_closedAt_idx";
ALTER TABLE "WorkItem" DROP COLUMN "closedAt";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261123090000_pecas_e_fecho';
COMMIT;
