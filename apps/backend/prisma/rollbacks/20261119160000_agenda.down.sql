-- Reversão manual de 20261119160000_agenda (Fase 2d). Correr só depois de voltar o código.
-- Perde-se: os horários marcados das tarefas.
BEGIN;
DROP INDEX "WorkItem_agendaAt_idx";
CREATE OR REPLACE FUNCTION "work_item_colunas_derivadas"() RETURNS trigger AS $$
BEGIN
  NEW."dueSort" := COALESCE(NEW."dueDate", '9999-12-31 00:00:00'::timestamp);
  NEW."searchText" := lower(unaccent(concat_ws(' ', NEW."title", NEW."description")));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER TABLE "WorkItem" DROP CONSTRAINT "WorkItem_horario_valido";
ALTER TABLE "WorkItem" DROP COLUMN "agendaAt", DROP COLUMN "scheduledEnd", DROP COLUMN "scheduledStart";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261119160000_agenda';
COMMIT;
