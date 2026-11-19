-- Fase 2c (docs/plano-fase-2-itens-de-trabalho.md): menu configurável. Só acrescenta (nenhum dado existente muda).
-- Reversão: prisma/rollbacks/20261119150000_menu_configuravel.down.sql.

-- Tipos de tarefa com item próprio no menu principal.
ALTER TABLE "WorkItemType" ADD COLUMN "showInMenu" BOOLEAN NOT NULL DEFAULT false;

-- Preferências do menu principal (uma linha, id "default"; sem linha = menu por omissão).
CREATE TABLE "MenuSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "entries" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuSetting_pkey" PRIMARY KEY ("id")
);
