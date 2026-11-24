-- Reversão manual de 20261124120000_pecas_produtos (Fase 5c). Correr só depois de voltar o código.
-- Perde-se: a ligação das peças aos produtos e quanto cada peça tirou do stock (os movimentos ficam).
BEGIN;
ALTER TABLE "ServicePart" DROP CONSTRAINT "ServicePart_stock_tirado";
ALTER TABLE "ServicePart" DROP CONSTRAINT "ServicePart_productId_fkey";
DROP INDEX "ServicePart_productId_idx";
ALTER TABLE "ServicePart" DROP COLUMN "stockTaken", DROP COLUMN "productId";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261124120000_pecas_produtos';
COMMIT;
