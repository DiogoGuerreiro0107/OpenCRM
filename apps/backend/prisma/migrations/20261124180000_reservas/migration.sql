-- Fase 6b: reservas de stock para as encomendas (docs/plano-fase-6-encomendas.md, pacote 6b).

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "reserved" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SalesOrderLine" ADD COLUMN     "reservedQuantity" DECIMAL(12,2) NOT NULL DEFAULT 0;


-- A reserva de uma linha vai de 0 à quantidade, e só linhas com produto reservam.
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_reserva"
  CHECK ("reservedQuantity" >= 0 AND "reservedQuantity" <= "quantity" AND ("reservedQuantity" = 0 OR "productId" IS NOT NULL));

ALTER TABLE "Product" ADD CONSTRAINT "Product_reservado_positivo" CHECK ("reserved" >= 0);

-- Product.reserved = soma das reservas das linhas. Só toca no produto quando a reserva (ou o produto) muda, para as
-- linhas dos rascunhos (sempre a zero) não bloquearem a linha do produto.
CREATE FUNCTION "sales_order_line_reserva"() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."reservedQuantity" <> 0
     AND (TG_OP = 'DELETE' OR OLD."reservedQuantity" IS DISTINCT FROM NEW."reservedQuantity" OR OLD."productId" IS DISTINCT FROM NEW."productId") THEN
    UPDATE "Product" SET "reserved" = "reserved" - OLD."reservedQuantity" WHERE "id" = OLD."productId";
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW."reservedQuantity" <> 0
     AND (TG_OP = 'INSERT' OR OLD."reservedQuantity" IS DISTINCT FROM NEW."reservedQuantity" OR OLD."productId" IS DISTINCT FROM NEW."productId") THEN
    UPDATE "Product" SET "reserved" = "reserved" + NEW."reservedQuantity" WHERE "id" = NEW."productId";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SalesOrderLine_reserva_no_produto"
  AFTER INSERT OR UPDATE OR DELETE ON "SalesOrderLine"
  FOR EACH ROW EXECUTE FUNCTION "sales_order_line_reserva"();
