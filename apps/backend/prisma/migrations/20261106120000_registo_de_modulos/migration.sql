-- Registo de módulos opcionais (Fase 0a). Tabela nova: nenhum dado existente é tocado; sem linhas = tudo ativo, como antes.
CREATE TABLE "ModuleSetting" (
    "moduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleSetting_pkey" PRIMARY KEY ("moduleId")
);
