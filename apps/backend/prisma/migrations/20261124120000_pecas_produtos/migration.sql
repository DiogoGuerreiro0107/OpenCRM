-- Fase 5c (docs/plano-fase-5-produtos-stock.md): peças das assistências ligadas a produtos do catálogo e ao stock.

-- AlterTable
ALTER TABLE "ServicePart" ADD COLUMN     "productId" TEXT,
ADD COLUMN     "stockTaken" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ServicePart_productId_idx" ON "ServicePart"("productId");

-- AddForeignKey
ALTER TABLE "ServicePart" ADD CONSTRAINT "ServicePart_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- O que a peça tirou do stock nunca é negativo, e só uma peça do catálogo tira stock.
ALTER TABLE "ServicePart" ADD CONSTRAINT "ServicePart_stock_tirado"
  CHECK ("stockTaken" >= 0 AND ("stockTaken" = 0 OR "productId" IS NOT NULL));
