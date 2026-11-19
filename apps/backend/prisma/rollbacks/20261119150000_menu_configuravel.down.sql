-- Reversão manual de 20261119150000_menu_configuravel (Fase 2c). Correr só depois de voltar o código.
-- Perde-se: as preferências do menu e a opção «aparece no menu» dos tipos de tarefa.
BEGIN;
DROP TABLE "MenuSetting";
ALTER TABLE "WorkItemType" DROP COLUMN "showInMenu";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261119150000_menu_configuravel';
COMMIT;
