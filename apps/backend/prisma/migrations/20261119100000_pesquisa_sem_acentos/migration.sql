-- Pesquisa sem acentos (docs/plano-seletores-com-pesquisa.md): «joao» encontra «João».
-- Colunas de pesquisa mantidas por TRIGGER (unaccent não é IMMUTABLE, por isso não pode ir num índice sobre uma
-- expressão), com índice GIN pg_trgm. O termo pesquisado é normalizado da mesma forma em src/common/search-text.ts.
BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Company" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Contact" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

CREATE FUNCTION "company_texto_pesquisa"() RETURNS trigger AS $$
BEGIN
  NEW."searchText" := lower(unaccent(concat_ws(' ', NEW."name", NEW."legalName", NEW."taxId", NEW."phone", NEW."email")));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Company_texto_pesquisa"
  BEFORE INSERT OR UPDATE ON "Company"
  FOR EACH ROW EXECUTE FUNCTION "company_texto_pesquisa"();

CREATE FUNCTION "contact_texto_pesquisa"() RETURNS trigger AS $$
BEGIN
  NEW."searchText" := lower(unaccent(concat_ws(' ', NEW."name", NEW."email", NEW."phone", NEW."mobilePhone")));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Contact_texto_pesquisa"
  BEFORE INSERT OR UPDATE ON "Contact"
  FOR EACH ROW EXECUTE FUNCTION "contact_texto_pesquisa"();

-- As leads (Fase 1b) passam também a ignorar acentos: a mesma função, agora com unaccent.
CREATE OR REPLACE FUNCTION "lead_colunas_derivadas"() RETURNS trigger AS $$
BEGIN
  NEW."nextActionSort" := COALESCE(NEW."nextActionAt", '9999-12-31 00:00:00'::timestamp);
  NEW."searchText" := lower(unaccent(concat_ws(' ', NEW."name", NEW."companyName", NEW."taxId", NEW."email", NEW."phone")));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Linhas que já existem: o UPDATE dispara o trigger e recalcula a coluna (o updatedAt é do Prisma, não muda).
UPDATE "Company" SET "searchText" = '';
UPDATE "Contact" SET "searchText" = '';
UPDATE "Lead" SET "searchText" = '';

CREATE INDEX "Company_searchText_idx" ON "Company" USING GIN ("searchText" gin_trgm_ops);
CREATE INDEX "Contact_searchText_idx" ON "Contact" USING GIN ("searchText" gin_trgm_ops);

COMMIT;
