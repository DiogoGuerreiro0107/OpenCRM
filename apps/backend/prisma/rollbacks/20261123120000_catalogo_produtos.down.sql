-- Reversão manual de 20261123120000_catalogo_produtos (Fase 5a). Correr só depois de voltar o código.
-- Perde-se: o catálogo de produtos, as categorias, os fornecedores dos produtos e a marca «fornecedor» das empresas.
BEGIN;
DROP TABLE "ProductSupplier";
DROP TABLE "Product";
DROP FUNCTION "product_texto_pesquisa"();
DROP TABLE "ProductCategory";
DROP TYPE "ProductUnit";
ALTER TABLE "Company" DROP COLUMN "isSupplier";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261123120000_catalogo_produtos';
COMMIT;
