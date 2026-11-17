-- Pacote 0b (docs/plano-fase-0-fundacoes.md): o tipo de registo dos campos personalizados deixa de ser um enum
-- fechado e passa a texto, COM OS MESMOS VALORES ("COMPANY", "CONTACT", "LEAD", "DEAL"). Nenhum dado muda.
-- Os índices únicos/compostos sobre estas colunas são reconstruídos automaticamente pela mudança de tipo.
ALTER TABLE "CustomField" ALTER COLUMN "entityType" TYPE TEXT USING "entityType"::TEXT;
ALTER TABLE "CustomFieldValue" ALTER COLUMN "entityType" TYPE TEXT USING "entityType"::TEXT;
DROP TYPE "CustomFieldEntityType";
