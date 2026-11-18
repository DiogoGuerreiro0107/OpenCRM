-- Fase 1b (docs/plano-fase-1-leads.md): leads de empresa ou de pessoa, ligação a empresas/contactos existentes, e
-- colunas para a listagem eficiente (ordenação por cursor e pesquisa com pg_trgm), validadas pelo teste de carga (1a).
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE "LeadKind" AS ENUM ('COMPANY', 'PERSON');

ALTER TABLE "Lead" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "contactId" TEXT,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "kind" "LeadKind" NOT NULL DEFAULT 'PERSON',
ADD COLUMN     "nextActionSort" TIMESTAMP(3) NOT NULL DEFAULT '9999-12-31 00:00:00'::timestamp,
ADD COLUMN     "searchText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "taxId" TEXT;

-- Colunas derivadas mantidas pela BASE DE DADOS (qualquer escrita, por qualquer caminho, fica coerente):
--   nextActionSort = nextActionAt, ou 9999-12-31 sem data (chave sem NULL para a paginação por cursor);
--   searchText     = nome, empresa, NIF, email e telefone, em minúsculas (pesquisa «contém» com pg_trgm).
CREATE FUNCTION "lead_colunas_derivadas"() RETURNS trigger AS $$
BEGIN
  NEW."nextActionSort" := COALESCE(NEW."nextActionAt", '9999-12-31 00:00:00'::timestamp);
  NEW."searchText" := lower(concat_ws(' ', NEW."name", NEW."companyName", NEW."taxId", NEW."email", NEW."phone"));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Lead_colunas_derivadas"
  BEFORE INSERT OR UPDATE ON "Lead"
  FOR EACH ROW EXECUTE FUNCTION "lead_colunas_derivadas"();

-- Leads que já existem: preencher as colunas derivadas (o UPDATE dispara o trigger) e classificar o tipo com uma
-- regra simples e reversível: com nome de empresa → COMPANY; sem → PERSON. Nada se perde: os dados soltos ficam.
UPDATE "Lead" SET "kind" = CASE WHEN NULLIF(btrim("companyName"), '') IS NOT NULL THEN 'COMPANY'::"LeadKind" ELSE 'PERSON'::"LeadKind" END;

CREATE INDEX "Lead_status_responsavelId_nextActionSort_id_idx" ON "Lead"("status", "responsavelId", "nextActionSort", "id");
CREATE INDEX "Lead_status_nextActionSort_id_idx" ON "Lead"("status", "nextActionSort", "id");
CREATE INDEX "Lead_nextActionSort_id_idx" ON "Lead"("nextActionSort", "id");
CREATE INDEX "Lead_kind_status_idx" ON "Lead"("kind", "status");
CREATE INDEX "Lead_responsavelId_status_idx" ON "Lead"("responsavelId", "status");
CREATE INDEX "Lead_companyId_idx" ON "Lead"("companyId");
CREATE INDEX "Lead_contactId_idx" ON "Lead"("contactId");
CREATE INDEX "Lead_searchText_idx" ON "Lead" USING GIN ("searchText" gin_trgm_ops);

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
