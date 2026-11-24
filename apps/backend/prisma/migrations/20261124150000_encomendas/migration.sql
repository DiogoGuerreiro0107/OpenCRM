-- Fase 6a (docs/plano-fase-6-encomendas.md): encomendas de cliente com linhas e totais indicativos.

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "TimelineEntityType" ADD VALUE 'ORDER';

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "companyId" TEXT,
    "contactId" TEXT,
    "assigneeId" TEXT,
    "customerReference" TEXT,
    "deliveryAddress" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchText" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT,
    "sku" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_number_key" ON "SalesOrder"("number");

-- CreateIndex
CREATE INDEX "SalesOrder_status_createdAt_idx" ON "SalesOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SalesOrder_createdAt_id_idx" ON "SalesOrder"("createdAt", "id");

-- CreateIndex
CREATE INDEX "SalesOrder_companyId_idx" ON "SalesOrder"("companyId");

-- CreateIndex
CREATE INDEX "SalesOrder_contactId_idx" ON "SalesOrder"("contactId");

-- CreateIndex
CREATE INDEX "SalesOrder_assigneeId_idx" ON "SalesOrder"("assigneeId");

-- CreateIndex
CREATE INDEX "SalesOrder_searchText_idx" ON "SalesOrder" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "SalesOrderLine_orderId_position_idx" ON "SalesOrderLine"("orderId", "position");

-- CreateIndex
CREATE INDEX "SalesOrderLine_productId_idx" ON "SalesOrderLine"("productId");

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Cliente: empresa e/ou contacto, pelo menos um.
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tem_cliente"
  CHECK ("companyId" IS NOT NULL OR "contactId" IS NOT NULL);

-- Cancelada tem motivo; os totais nunca são negativos.
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_cancelada_com_motivo"
  CHECK (("status" = 'CANCELLED') = ("cancelReason" IS NOT NULL AND "cancelledAt" IS NOT NULL));
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_totais"
  CHECK ("subtotal" >= 0 AND "vatTotal" >= 0 AND "total" = "subtotal" + "vatTotal");

-- Limites das linhas.
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_limites"
  CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "discountPct" >= 0 AND "discountPct" <= 100
         AND "vatRate" >= 0 AND "vatRate" <= 100 AND "lineTotal" >= 0 AND "position" >= 0);

-- Texto de pesquisa da encomenda: número («en-0001» e «1»), referência do cliente. Os nomes do cliente pesquisam-se
-- no texto da empresa e do contacto (já mantido por trigger nessas tabelas).
CREATE FUNCTION "sales_order_texto_pesquisa"() RETURNS trigger AS $$
BEGIN
  NEW."searchText" := lower(unaccent(concat_ws(' ', 'en-' || lpad(NEW."number"::text, 4, '0'), NEW."customerReference")));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SalesOrder_texto_pesquisa"
  BEFORE INSERT OR UPDATE ON "SalesOrder"
  FOR EACH ROW EXECUTE FUNCTION "sales_order_texto_pesquisa"();
