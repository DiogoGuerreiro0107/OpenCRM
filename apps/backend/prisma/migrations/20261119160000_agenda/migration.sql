-- Fase 2d (docs/plano-fase-2-itens-de-trabalho.md): horário marcado nas tarefas e momento na agenda.
-- Reversão: prisma/rollbacks/20261119160000_agenda.down.sql.

ALTER TABLE "WorkItem" ADD COLUMN "scheduledStart" TIMESTAMP(3),
ADD COLUMN "scheduledEnd" TIMESTAMP(3),
ADD COLUMN "agendaAt" TIMESTAMP(3);

-- O fim exige início e não pode ser antes dele.
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_horario_valido"
  CHECK ("scheduledEnd" IS NULL OR ("scheduledStart" IS NOT NULL AND "scheduledEnd" >= "scheduledStart"));

-- O trigger das colunas derivadas passa a calcular também o momento na agenda (início marcado, senão o prazo).
CREATE OR REPLACE FUNCTION "work_item_colunas_derivadas"() RETURNS trigger AS $$
BEGIN
  NEW."dueSort" := COALESCE(NEW."dueDate", '9999-12-31 00:00:00'::timestamp);
  NEW."searchText" := lower(unaccent(concat_ws(' ', NEW."title", NEW."description")));
  NEW."agendaAt" := COALESCE(NEW."scheduledStart", NEW."dueDate");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tarefas existentes: ainda não têm horário marcado, por isso o momento na agenda é o prazo.
UPDATE "WorkItem" SET "agendaAt" = "dueDate" WHERE "dueDate" IS NOT NULL;

CREATE INDEX "WorkItem_agendaAt_idx" ON "WorkItem"("agendaAt");
