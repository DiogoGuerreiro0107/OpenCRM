-- Pacote 0d (docs/plano-fase-0-fundacoes.md): permissões de escrita configuráveis por área.
-- Sem linhas = tudo como antes (as predefinições estão em código).
CREATE TABLE "PermissionSetting" (
    "area" TEXT NOT NULL,
    "roles" "Role"[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionSetting_pkey" PRIMARY KEY ("area")
);
