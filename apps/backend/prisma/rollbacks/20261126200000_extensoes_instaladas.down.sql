-- Reverte 20261126200000_extensoes_instaladas (Fase E1.4). Apaga só o registo das extensões instaladas.
DROP TABLE IF EXISTS "InstalledExtension";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261126200000_extensoes_instaladas';
