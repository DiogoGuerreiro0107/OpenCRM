-- CreateEnum
CREATE TYPE "LeadInterest" AS ENUM ('IMPRESSAO', 'SOFTWARE', 'INFORMATICA', 'PAPELARIA', 'POS', 'ASSISTENCIA', 'OUTRO');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NOVO', 'CONTACTADO', 'SEM_RESPOSTA', 'CONVERTIDO', 'PERDIDO');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "leadId" TEXT;

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "source" TEXT,
    "interest" "LeadInterest",
    "status" "LeadStatus" NOT NULL DEFAULT 'NOVO',
    "responsavelId" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "notes" TEXT,
    "convertedDealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_convertedDealId_key" ON "Lead"("convertedDealId");

-- CreateIndex
CREATE INDEX "Lead_responsavelId_idx" ON "Lead"("responsavelId");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_convertedDealId_fkey" FOREIGN KEY ("convertedDealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
