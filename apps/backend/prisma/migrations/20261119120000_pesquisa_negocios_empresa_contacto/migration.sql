-- Pesquisa no quadro de negócios (docs/plano-paginacao-listagens.md): o searchText do negócio passa a incluir o da
-- empresa e o do contacto ligados. Assim a pesquisa usa só o índice GIN do negócio; com LEFT JOIN + OR às outras
-- tabelas, o Postgres percorria a coluna inteira (medido: 143 ms numa coluna de 100 000 negócios).
BEGIN;

CREATE OR REPLACE FUNCTION "deal_texto_pesquisa"() RETURNS trigger AS $$
BEGIN
  NEW."searchText" := concat_ws(' ',
    lower(unaccent(coalesce(NEW."title", ''))),
    (SELECT c."searchText" FROM "Company" c WHERE c."id" = NEW."companyId"),
    (SELECT k."searchText" FROM "Contact" k WHERE k."id" = NEW."contactId"));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Quando o texto de pesquisa de uma empresa ou contacto muda, recalcula o dos seus negócios (o UPDATE dispara o
-- trigger acima; o updatedAt é do Prisma e não muda). Apagar a empresa/contacto põe a ligação a NULL, o que também
-- dispara o trigger do negócio.
CREATE FUNCTION "deal_texto_pesquisa_ligacoes"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'Company' THEN
    UPDATE "Deal" SET "searchText" = '' WHERE "companyId" = NEW."id";
  ELSE
    UPDATE "Deal" SET "searchText" = '' WHERE "contactId" = NEW."id";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Company_pesquisa_negocios"
  AFTER UPDATE ON "Company"
  FOR EACH ROW WHEN (OLD."searchText" IS DISTINCT FROM NEW."searchText")
  EXECUTE FUNCTION "deal_texto_pesquisa_ligacoes"();

CREATE TRIGGER "Contact_pesquisa_negocios"
  AFTER UPDATE ON "Contact"
  FOR EACH ROW WHEN (OLD."searchText" IS DISTINCT FROM NEW."searchText")
  EXECUTE FUNCTION "deal_texto_pesquisa_ligacoes"();

UPDATE "Deal" SET "searchText" = '';

COMMIT;
