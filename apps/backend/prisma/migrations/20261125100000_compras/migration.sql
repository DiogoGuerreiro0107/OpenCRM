-- Fase 6c (docs/plano-fase-6-encomendas.md): compras a fornecedor, com receção para o stock, e a ligação das tarefas
-- às encomendas («Preparar encomenda»).

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "TimelineEntityType" ADD VALUE 'PURCHASE_ORDER';

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "salesOrderId" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "preparationTaskAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierId" TEXT NOT NULL,
    "supplierReference" TEXT,
    "expectedAt" DATE,
    "notes" TEXT,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchText" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplierSku" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(12,4) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "receivedQuantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_createdAt_idx" ON "PurchaseOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_createdAt_id_idx" ON "PurchaseOrder"("createdAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_searchText_idx" ON "PurchaseOrder" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_position_idx" ON "PurchaseOrderLine"("purchaseOrderId", "position");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_productId_idx" ON "PurchaseOrderLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_purchaseOrderId_productId_key" ON "PurchaseOrderLine"("purchaseOrderId", "productId");

-- CreateIndex
CREATE INDEX "WorkItem_salesOrderId_idx" ON "WorkItem"("salesOrderId");

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Limites das linhas: quantidade positiva, custo e total não negativos, recebido entre 0 e a quantidade.
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_limites"
  CHECK ("quantity" > 0 AND "unitCost" >= 0 AND "lineTotal" >= 0 AND "position" >= 0
         AND "receivedQuantity" >= 0 AND "receivedQuantity" <= "quantity");

-- Fechada (com falta) ou cancelada tem motivo, e só essas; o total nunca é negativo.
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_motivo"
  CHECK (("status" IN ('CLOSED', 'CANCELLED')) = ("closeReason" IS NOT NULL));
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_total" CHECK ("total" >= 0);

-- Texto de pesquisa da compra: número («cf-0001») e referência do fornecedor. O nome do fornecedor pesquisa-se no
-- texto da empresa (já mantido por trigger).
CREATE FUNCTION "purchase_order_texto_pesquisa"() RETURNS trigger AS $$
BEGIN
  NEW."searchText" := lower(unaccent(concat_ws(' ', 'cf-' || lpad(NEW."number"::text, 4, '0'), NEW."supplierReference")));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PurchaseOrder_texto_pesquisa"
  BEFORE INSERT OR UPDATE ON "PurchaseOrder"
  FOR EACH ROW EXECUTE FUNCTION "purchase_order_texto_pesquisa"();

-- Tipo de item de sistema «Preparar encomenda» (o arranque também o repõe se faltar; um tipo com o mesmo código, se
-- existir, fica como está).
INSERT INTO "WorkItemType" ("id", "name", "icon", "color", "isSystem", "sortOrder", "updatedAt") VALUES
    ('PREPARAR_ENCOMENDA', 'Preparar encomenda', 'package', 'orange', true, 8, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
