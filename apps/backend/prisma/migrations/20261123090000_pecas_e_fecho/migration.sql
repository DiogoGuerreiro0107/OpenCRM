-- Fase 4c (docs/plano-fase-4-assistencias.md): peças usadas nas assistências e hora de fecho dos itens de trabalho.
-- Reversão: prisma/rollbacks/20261123090000_pecas_e_fecho.down.sql.

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "closedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ServicePart" (
    "id" TEXT NOT NULL,
    "serviceCaseId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServicePart_serviceCaseId_createdAt_idx" ON "ServicePart"("serviceCaseId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkItem_closedAt_idx" ON "WorkItem"("closedAt");

-- AddForeignKey
ALTER TABLE "ServicePart" ADD CONSTRAINT "ServicePart_serviceCaseId_fkey" FOREIGN KEY ("serviceCaseId") REFERENCES "ServiceCase"("workItemId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePart" ADD CONSTRAINT "ServicePart_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Quantidade positiva.
ALTER TABLE "ServicePart" ADD CONSTRAINT "ServicePart_quantidade_positiva" CHECK ("quantity" > 0);

-- Itens já fechados: a hora do registo «Tarefa concluída/cancelada» na timeline (o mais recente), senão a última
-- alteração.
UPDATE "WorkItem" w SET "closedAt" = COALESCE(
  (SELECT max(te."createdAt") FROM "TimelineEvent" te
    WHERE te."entityType"::text = 'TASK' AND te."entityId" = w."id"
      AND (te."description" LIKE 'Tarefa concluída:%' OR te."description" LIKE 'Tarefa cancelada:%')),
  w."updatedAt")
WHERE w."status"::text IN ('DONE', 'CANCELLED');

-- Daqui em diante, a hora de fecho é mantida pela base de dados, venha a mudança de estado de onde vier: fechar grava
-- a hora (UTC, como as restantes colunas), reabrir limpa-a, e mudar entre concluída e cancelada mantém-na.
CREATE FUNCTION "work_item_fechado_em"() RETURNS trigger AS $$
BEGIN
  IF NEW."status"::text IN ('DONE', 'CANCELLED') THEN
    IF TG_OP = 'INSERT' OR OLD."status"::text NOT IN ('DONE', 'CANCELLED') THEN
      NEW."closedAt" := now() AT TIME ZONE 'UTC';
    ELSE
      NEW."closedAt" := COALESCE(OLD."closedAt", now() AT TIME ZONE 'UTC');
    END IF;
  ELSE
    NEW."closedAt" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkItem_fechado_em"
  BEFORE INSERT OR UPDATE OF "status" ON "WorkItem"
  FOR EACH ROW EXECUTE FUNCTION "work_item_fechado_em"();
