-- Reversão manual de 20261119180000_automacoes_regras_sistema (Fase 3b). Correr só depois de voltar o código.
-- As regras do sistema ficam como regras normais (o código antigo volta a criar a tarefa da lead à mão: apaga-se a
-- regra «Primeiro contacto da lead», senão a tarefa seria criada duas vezes).
BEGIN;
DELETE FROM "AutomationRule" WHERE "systemKey" = 'lead.first_contact';
DROP INDEX "AutomationRule_systemKey_key";
ALTER TABLE "AutomationRule" DROP COLUMN "systemKey";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261119180000_automacoes_regras_sistema';
COMMIT;
