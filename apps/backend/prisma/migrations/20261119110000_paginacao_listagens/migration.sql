-- Paginação e pesquisa nas listagens (docs/plano-paginacao-listagens.md).
-- 1) Colunas de pesquisa sem acentos mantidas por TRIGGER (como Company/Contact em 20261119100000), com índice GIN
--    pg_trgm: tarefas (título, descrição), negócios (título) e emails (assunto, remetente, destinatários).
-- 2) Task."dueSort" = prazo, ou 9999-12-31 sem prazo: chave sem NULL para o cursor da lista de tarefas (como
--    Lead."nextActionSort").
-- 3) Índices pela ordem de cada lista paginada (chave do cursor).
BEGIN;

ALTER TABLE "Deal" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "EmailMessage" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Task" ADD COLUMN "dueSort" TIMESTAMP(3) NOT NULL DEFAULT '9999-12-31 00:00:00'::timestamp without time zone,
ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

CREATE FUNCTION "task_colunas_derivadas"() RETURNS trigger AS $$
BEGIN
  NEW."dueSort" := COALESCE(NEW."dueDate", '9999-12-31 00:00:00'::timestamp);
  NEW."searchText" := lower(unaccent(concat_ws(' ', NEW."title", NEW."description")));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Task_colunas_derivadas"
  BEFORE INSERT OR UPDATE ON "Task"
  FOR EACH ROW EXECUTE FUNCTION "task_colunas_derivadas"();

CREATE FUNCTION "deal_texto_pesquisa"() RETURNS trigger AS $$
BEGIN
  NEW."searchText" := lower(unaccent(coalesce(NEW."title", '')));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Deal_texto_pesquisa"
  BEFORE INSERT OR UPDATE ON "Deal"
  FOR EACH ROW EXECUTE FUNCTION "deal_texto_pesquisa"();

CREATE FUNCTION "email_texto_pesquisa"() RETURNS trigger AS $$
BEGIN
  NEW."searchText" := lower(unaccent(concat_ws(' ', NEW."subject", NEW."fromName", NEW."fromAddress", array_to_string(NEW."toAddresses", ' '))));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EmailMessage_texto_pesquisa"
  BEFORE INSERT OR UPDATE ON "EmailMessage"
  FOR EACH ROW EXECUTE FUNCTION "email_texto_pesquisa"();

-- Linhas que já existem: o UPDATE dispara o trigger e recalcula as colunas.
UPDATE "Task" SET "searchText" = '';
UPDATE "Deal" SET "searchText" = '';
UPDATE "EmailMessage" SET "searchText" = '';

CREATE INDEX "Task_searchText_idx" ON "Task" USING GIN ("searchText" gin_trgm_ops);
CREATE INDEX "Deal_searchText_idx" ON "Deal" USING GIN ("searchText" gin_trgm_ops);
CREATE INDEX "EmailMessage_searchText_idx" ON "EmailMessage" USING GIN ("searchText" gin_trgm_ops);

-- Índices pela ordem das listas (os de uma só coluna que ficam cobertos pelos novos saem).
DROP INDEX "CallRecord_startedAt_idx";
DROP INDEX "TimelineEvent_entityType_entityId_idx";
CREATE INDEX "CallRecord_startedAt_id_idx" ON "CallRecord"("startedAt" DESC, "id" DESC);
CREATE INDEX "TimelineEvent_entityType_entityId_createdAt_id_idx" ON "TimelineEvent"("entityType", "entityId", "createdAt" DESC, "id" DESC);
CREATE INDEX "Company_name_id_idx" ON "Company"("name", "id");
CREATE INDEX "Contact_name_id_idx" ON "Contact"("name", "id");
CREATE INDEX "Deal_stageId_order_id_idx" ON "Deal"("stageId", "order", "id");
CREATE INDEX "EmailMessage_sentAt_id_idx" ON "EmailMessage"("sentAt" DESC, "id" DESC);
CREATE INDEX "Task_dueSort_createdAt_id_idx" ON "Task"("dueSort", "createdAt" DESC, "id" DESC);

COMMIT;
