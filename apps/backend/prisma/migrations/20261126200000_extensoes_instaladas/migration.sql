-- CreateTable
CREATE TABLE "InstalledExtension" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "approvedChecksum" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '{}',
    "state" JSONB NOT NULL DEFAULT '{}',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "disabledReason" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstalledExtension_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "InstalledExtension" ADD CONSTRAINT "InstalledExtension_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Fase E1.4: as falhas seguidas nunca são negativas.
ALTER TABLE "InstalledExtension" ADD CONSTRAINT "InstalledExtension_falhas" CHECK ("consecutiveFailures" >= 0);
