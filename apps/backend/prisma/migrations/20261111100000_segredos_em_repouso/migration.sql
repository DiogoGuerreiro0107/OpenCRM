-- Pacote E0a (docs/plano-e0-api-publica.md): o token de recuperação de password deixa de ser guardado em claro;
-- guarda-se o SHA-256. Os pedidos de recuperação pendentes são invalidados (duram 1 hora, basta pedir outro):
-- é mais seguro limpar do que manter tokens válidos que estiveram guardados em claro.
ALTER TABLE "User" RENAME COLUMN "resetToken" TO "resetTokenHash";
ALTER INDEX "User_resetToken_key" RENAME TO "User_resetTokenHash_key";
UPDATE "User" SET "resetTokenHash" = NULL, "resetTokenExpiresAt" = NULL;
