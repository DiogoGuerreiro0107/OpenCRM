-- Reversão manual de 20261120120000_registo_de_tempo (Fase 4b). Correr só depois de voltar o código.
-- Perde-se: todos os registos de tempo (cronómetros e registos manuais). Os itens de trabalho ficam.
BEGIN;
DROP TABLE "TimeEntry";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261120120000_registo_de_tempo';
COMMIT;
