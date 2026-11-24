-- Reversão manual de 20261124180000_reservas (Fase 6b). Correr só depois de voltar o código.
-- Perde-se: as reservas (as encomendas, as linhas e o stock ficam).
BEGIN;
DROP TRIGGER IF EXISTS "SalesOrderLine_reserva_no_produto" ON "SalesOrderLine";
DROP FUNCTION IF EXISTS "sales_order_line_reserva"();
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_reservado_positivo";
ALTER TABLE "SalesOrderLine" DROP CONSTRAINT IF EXISTS "SalesOrderLine_reserva";
ALTER TABLE "SalesOrderLine" DROP COLUMN "reservedQuantity";
ALTER TABLE "Product" DROP COLUMN "reserved";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261124180000_reservas';
COMMIT;
