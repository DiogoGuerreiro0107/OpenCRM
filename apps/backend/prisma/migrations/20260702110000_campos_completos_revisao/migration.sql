-- Revisao "campos completos" (Empresa/Contacto/Negocio/Tarefa), conforme CLAUDE.md.

-- Renomear LeadInterest -> BusinessArea (mesmo enum, agora partilhado por Lead.interest e Deal.type)
ALTER TYPE "LeadInterest" RENAME TO "BusinessArea";

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ATIVO', 'POTENCIAL', 'INATIVO', 'PERDIDO');

-- CreateEnum
CREATE TYPE "CompanySource" AS ENUM ('SITE', 'LOJA', 'CHAMADA', 'CAMPANHA', 'IMPORTACAO', 'RECOMENDACAO', 'OUTRO');

-- CreateEnum
CREATE TYPE "PreferredChannel" AS ENUM ('TELEFONE', 'EMAIL', 'WHATSAPP', 'PRESENCIAL');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('CHAMADA', 'EMAIL', 'VISITA', 'PROPOSTA', 'COBRANCA', 'ASSISTENCIA', 'OUTRO');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('BAIXA', 'NORMAL', 'ALTA', 'URGENTE');

-- AlterTable Company
ALTER TABLE "Company"
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "status" "CompanyStatus" NOT NULL DEFAULT 'POTENCIAL',
  ADD COLUMN "source" "CompanySource",
  ADD COLUMN "ownerId" TEXT;

-- AlterTable Contact
ALTER TABLE "Contact"
  ADD COLUMN "mobilePhone" TEXT,
  ADD COLUMN "department" TEXT,
  ADD COLUMN "preferredChannel" "PreferredChannel",
  ADD COLUMN "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ownerId" TEXT;

-- AlterTable Deal
ALTER TABLE "Deal"
  ADD COLUMN "type" "BusinessArea",
  ADD COLUMN "estimatedMargin" DOUBLE PRECISION,
  ADD COLUMN "lossReason" TEXT;

-- AlterTable Task
ALTER TABLE "Task"
  ADD COLUMN "type" "TaskType",
  ADD COLUMN "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "result" TEXT;

-- CreateIndex
CREATE INDEX "Company_ownerId_idx" ON "Company"("ownerId");

-- CreateIndex
CREATE INDEX "Contact_ownerId_idx" ON "Contact"("ownerId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
