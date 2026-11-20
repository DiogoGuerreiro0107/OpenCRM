-- Fase 4a (docs/plano-fase-4-assistencias.md): assistências = dados próprios 1:1 dos itens de trabalho do tipo
-- «Assistência». Reversão: prisma/rollbacks/20261120090000_assistencias.down.sql.

CREATE TYPE "ServiceWarranty" AS ENUM ('YES', 'NO', 'UNKNOWN');

CREATE TABLE "ServiceCase" (
    "workItemId" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "underWarranty" "ServiceWarranty" NOT NULL DEFAULT 'UNKNOWN',
    "reportedProblem" TEXT NOT NULL,
    "diagnosis" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCase_pkey" PRIMARY KEY ("workItemId")
);

CREATE UNIQUE INDEX "ServiceCase_number_key" ON "ServiceCase"("number");
CREATE INDEX "ServiceCase_serialNumber_idx" ON "ServiceCase"("serialNumber");
ALTER TABLE "ServiceCase" ADD CONSTRAINT "ServiceCase_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- As tarefas do tipo «Assistência» que já existem passam a assistências (números pela ordem de criação); o problema
-- reportado é a descrição da tarefa, ou o título se não tiver.
INSERT INTO "ServiceCase" ("workItemId", "reportedProblem", "createdAt", "updatedAt")
SELECT w."id", COALESCE(NULLIF(btrim(w."description"), ''), w."title"), w."createdAt", w."updatedAt"
FROM "WorkItem" w
WHERE w."typeId" = 'ASSISTENCIA'
ORDER BY w."createdAt", w."id";
