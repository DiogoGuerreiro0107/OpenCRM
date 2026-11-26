-- Reversão manual de 20261125150000_expedicoes (Fase 6d). Correr só depois de voltar o código.
-- Perde-se: as transportadoras, as expedições (transportadora, código, volumes, peso, custo) e o enviado de cada
-- linha. Uma encomenda parcialmente enviada volta a parecer confirmada sem nada enviado (as saídas de stock ficam no
-- livro de stock); a timeline mantém o que foi escrito.
BEGIN;
DROP TABLE "ShipmentLine";
DROP TABLE "Shipment";
DROP TABLE "Carrier";
DROP TRIGGER "SalesOrderLine_por_enviar" ON "SalesOrderLine";
DROP FUNCTION "sales_order_line_por_enviar"();
ALTER TABLE "SalesOrderLine" DROP CONSTRAINT "SalesOrderLine_reserva";
ALTER TABLE "SalesOrderLine" DROP CONSTRAINT "SalesOrderLine_envio";
ALTER TABLE "SalesOrderLine" DROP COLUMN "shippedQuantity";
ALTER TABLE "SalesOrderLine" DROP COLUMN "unshippedQuantity";
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_reserva"
  CHECK ("reservedQuantity" >= 0 AND "reservedQuantity" <= "quantity" AND ("reservedQuantity" = 0 OR "productId" IS NOT NULL));
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261125150000_expedicoes';
COMMIT;
