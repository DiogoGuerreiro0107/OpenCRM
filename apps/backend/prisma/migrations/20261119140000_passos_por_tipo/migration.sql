-- Fase 2b (docs/plano-fase-2-itens-de-trabalho.md): passos por tipo de tarefa e campos personalizados por tipo.
-- Só acrescenta colunas (opcionais ou com valor por omissão): nenhum dado existente muda.
-- Reversão: prisma/rollbacks/20261119140000_passos_por_tipo.down.sql.

-- Campos personalizados: âmbito dentro do tipo de registo ("" = todos). A unicidade passa a contar com o âmbito.
DROP INDEX "CustomField_entityType_fieldName_key";
ALTER TABLE "CustomField" ADD COLUMN "scopeId" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "CustomField_entityType_scopeId_fieldName_key" ON "CustomField"("entityType", "scopeId", "fieldName");

-- Passo de cada item e fluxo de cada tipo
ALTER TABLE "WorkItem" ADD COLUMN "stepId" TEXT;
ALTER TABLE "WorkItemType" ADD COLUMN "workflowId" TEXT;
CREATE INDEX "WorkItem_stepId_idx" ON "WorkItem"("stepId");
CREATE UNIQUE INDEX "WorkItemType_workflowId_key" ON "WorkItemType"("workflowId");
ALTER TABLE "WorkItemType" ADD CONSTRAINT "WorkItemType_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "WorkflowStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rede de segurança (o serviço valida antes, com mensagens): num tipo com passos, o item tem um passo DESSE fluxo e o
-- estado da categoria do passo (OPEN → PENDING; as outras com o mesmo nome); num tipo sem passos, não tem passo.
CREATE FUNCTION "work_item_passo_coerente"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fluxo_do_tipo TEXT;
  fluxo_do_passo TEXT;
  categoria TEXT;
BEGIN
  -- FOR SHARE: espera por quem esteja a dar ou tirar passos a este tipo e lê o resultado (sem corridas).
  SELECT "workflowId" INTO fluxo_do_tipo FROM "WorkItemType" WHERE "id" = NEW."typeId" FOR SHARE;
  IF NEW."stepId" IS NULL THEN
    IF fluxo_do_tipo IS NOT NULL THEN
      RAISE EXCEPTION 'WorkItem %: o tipo % tem passos e o item não tem passo', NEW."id", NEW."typeId";
    END IF;
    RETURN NEW;
  END IF;
  SELECT "workflowId", "category"::text INTO fluxo_do_passo, categoria FROM "WorkflowStep" WHERE "id" = NEW."stepId";
  IF fluxo_do_tipo IS NULL OR fluxo_do_tipo IS DISTINCT FROM fluxo_do_passo THEN
    RAISE EXCEPTION 'WorkItem %: o passo % não é do fluxo do tipo %', NEW."id", NEW."stepId", NEW."typeId";
  END IF;
  IF NEW."status"::text <> (CASE categoria WHEN 'OPEN' THEN 'PENDING' ELSE categoria END) THEN
    RAISE EXCEPTION 'WorkItem %: o estado % não corresponde ao passo % (%)', NEW."id", NEW."status", NEW."stepId", categoria;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "WorkItem_passo_coerente"
  BEFORE INSERT OR UPDATE OF "stepId", "status", "typeId" ON "WorkItem"
  FOR EACH ROW EXECUTE FUNCTION "work_item_passo_coerente"();
