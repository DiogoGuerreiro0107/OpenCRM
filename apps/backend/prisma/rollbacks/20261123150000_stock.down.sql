-- Reversão manual de 20261123150000_stock (Fase 5b). Correr só depois de voltar o código.
-- Perde-se: todos os movimentos de stock e o stock atual dos produtos.
BEGIN;
DROP TRIGGER "Product_abaixo_do_minimo" ON "Product";
DROP FUNCTION "product_abaixo_do_minimo"();
DROP TABLE "StockMovement";
DROP FUNCTION "stock_movement_soma"();
DROP FUNCTION "stock_movement_imutavel"();
DROP TYPE "StockMovementType";
DROP INDEX "Product_belowMin_idx";
DROP INDEX "Product_stockOnHand_idx";
ALTER TABLE "Product" DROP COLUMN "belowMin", DROP COLUMN "stockOnHand";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261123150000_stock';
COMMIT;
