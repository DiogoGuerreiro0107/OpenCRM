-- Revisao "Recuperacao de password" (Fase 0), conforme CLAUDE.md.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "resetToken" TEXT,
ADD COLUMN "resetTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_resetToken_key" ON "User"("resetToken");
