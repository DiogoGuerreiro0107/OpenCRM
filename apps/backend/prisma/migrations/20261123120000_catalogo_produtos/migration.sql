-- Fase 5a (docs/plano-fase-5-produtos-stock.md): catálogo de produtos, categorias e fornecedores.
-- Reversão: prisma/rollbacks/20261123120000_catalogo_produtos.down.sql.

-- CreateEnum
CREATE TYPE "ProductUnit" AS ENUM ('UN', 'CX', 'PACK', 'KG', 'M', 'L', 'H');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "isSupplier" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" "ProductUnit" NOT NULL DEFAULT 'UN',
    "salePrice" DECIMAL(12,2),
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 23,
    "categoryId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tracksStock" BOOLEAN NOT NULL DEFAULT true,
    "minStock" DECIMAL(12,2),
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSupplier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierSku" TEXT,
    "costPrice" DECIMAL(12,4),
    "preferredFor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_searchText_idx" ON "Product" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_nameKey_key" ON "ProductCategory"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSupplier_preferredFor_key" ON "ProductSupplier"("preferredFor");

-- CreateIndex
CREATE INDEX "ProductSupplier_companyId_idx" ON "ProductSupplier"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSupplier_productId_companyId_key" ON "ProductSupplier"("productId", "companyId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Valores válidos.
ALTER TABLE "Product" ADD CONSTRAINT "Product_valores_validos"
  CHECK (("salePrice" IS NULL OR "salePrice" >= 0) AND "vatRate" >= 0 AND "vatRate" <= 100 AND ("minStock" IS NULL OR "minStock" >= 0));
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_custo_valido" CHECK ("costPrice" IS NULL OR "costPrice" >= 0);
-- Um só preferido por produto: «preferredFor» (única) é o próprio produto ou nada.
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_preferido_coerente"
  CHECK ("preferredFor" IS NULL OR "preferredFor" = "productId");

-- Pesquisa sem acentos (como nas empresas): referência, nome, código de barras e descrição.
CREATE FUNCTION "product_texto_pesquisa"() RETURNS trigger AS $$
BEGIN
  NEW."searchText" := lower(unaccent(concat_ws(' ', NEW."sku", NEW."name", NEW."barcode", NEW."description")));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Product_texto_pesquisa"
  BEFORE INSERT OR UPDATE ON "Product"
  FOR EACH ROW EXECUTE FUNCTION "product_texto_pesquisa"();
