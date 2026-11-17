-- Pacote E0e (docs/plano-e0-api-publica.md): ligação entre registos do CRM e ids de sistemas externos.
CREATE TABLE "ExternalLink" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalLink_provider_entityType_externalId_key" ON "ExternalLink"("provider", "entityType", "externalId");
CREATE UNIQUE INDEX "ExternalLink_provider_entityType_entityId_key" ON "ExternalLink"("provider", "entityType", "entityId");
CREATE INDEX "ExternalLink_entityType_entityId_idx" ON "ExternalLink"("entityType", "entityId");
