-- Reversão manual de 20261120090000_assistencias (Fase 4a). Correr só depois de voltar o código.
-- Perde-se: os dados próprios das assistências (equipamento, diagnóstico, resolução, números). As tarefas ficam.
BEGIN;
DROP TABLE "ServiceCase";
DROP TYPE "ServiceWarranty";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261120090000_assistencias';
COMMIT;
