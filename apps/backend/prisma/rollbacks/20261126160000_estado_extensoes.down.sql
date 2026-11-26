-- Reverte 20261126160000_estado_extensoes (Fase E1.3). Apaga só o estado interno das extensões.
ALTER TABLE "ModuleSetting" DROP COLUMN IF EXISTS "state";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261126160000_estado_extensoes';
