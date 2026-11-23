-- Fase 5b (docs/plano-fase-5-produtos-stock.md): stock como livro de movimentos.
-- Reversão: prisma/rollbacks/20261123150000_stock.down.sql.

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('INITIAL', 'PURCHASE_IN', 'SALE_OUT', 'RETURN', 'ADJUSTMENT', 'SERVICE_PART');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "belowMin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stockOnHand" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_sourceType_sourceId_idx" ON "StockMovement"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Product_belowMin_idx" ON "Product"("belowMin");

-- CreateIndex
CREATE INDEX "Product_stockOnHand_idx" ON "Product"("stockOnHand");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Sinal de cada tipo: entradas positivas, saídas negativas, acertos e consumos dos dois lados; nunca zero.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sinal_do_tipo" CHECK (
  "quantity" <> 0 AND (
    ("type" IN ('INITIAL', 'PURCHASE_IN', 'RETURN') AND "quantity" > 0)
    OR ("type" = 'SALE_OUT' AND "quantity" < 0)
    OR "type" IN ('ADJUSTMENT', 'SERVICE_PART')
  )
);

-- Só se acrescenta: corrigir é lançar outro movimento (como na auditoria).
CREATE FUNCTION "stock_movement_imutavel"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Os movimentos de stock são só de acrescentar: corrige com outro movimento';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockMovement_sem_update_delete"
  BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION "stock_movement_imutavel"();

-- Stock atual = soma dos movimentos: cada movimento novo soma-se ao produto.
CREATE FUNCTION "stock_movement_soma"() RETURNS trigger AS $$
BEGIN
  UPDATE "Product" SET "stockOnHand" = "stockOnHand" + NEW."quantity" WHERE "id" = NEW."productId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockMovement_soma_no_produto"
  AFTER INSERT ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION "stock_movement_soma"();

-- Abaixo do mínimo: mínimo definido e stock atual menor (recalculado sempre que o produto muda).
CREATE FUNCTION "product_abaixo_do_minimo"() RETURNS trigger AS $$
BEGIN
  NEW."belowMin" := NEW."minStock" IS NOT NULL AND NEW."stockOnHand" < NEW."minStock";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Product_abaixo_do_minimo"
  BEFORE INSERT OR UPDATE ON "Product"
  FOR EACH ROW EXECUTE FUNCTION "product_abaixo_do_minimo"();

-- Produtos que já têm mínimo: ainda sem movimentos, o stock é 0.
UPDATE "Product" SET "belowMin" = ("minStock" IS NOT NULL AND "stockOnHand" < "minStock");
