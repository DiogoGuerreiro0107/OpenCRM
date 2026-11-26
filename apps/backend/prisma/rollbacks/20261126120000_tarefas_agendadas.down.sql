-- Reverte 20261126120000_tarefas_agendadas (Fase E1.2). Apaga só o registo das tarefas agendadas.
DROP TABLE IF EXISTS "ScheduledJobRun";
DROP TABLE IF EXISTS "ScheduledJobState";
DROP TYPE IF EXISTS "ScheduledJobTrigger";
DROP TYPE IF EXISTS "ScheduledJobRunStatus";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261126120000_tarefas_agendadas';
