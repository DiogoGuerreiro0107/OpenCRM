-- Fase 3b (docs/plano-fase-3-automacoes.md): chave das regras de automação do sistema (a regra «Primeiro contacto da
-- lead» é criada pelo arranque da aplicação, como os tipos de tarefa do sistema). Reversão:
-- prisma/rollbacks/20261119180000_automacoes_regras_sistema.down.sql.
ALTER TABLE "AutomationRule" ADD COLUMN "systemKey" TEXT;
CREATE UNIQUE INDEX "AutomationRule_systemKey_key" ON "AutomationRule"("systemKey");
