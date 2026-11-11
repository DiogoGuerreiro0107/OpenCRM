-- Pacote E0b (docs/plano-e0-api-publica.md): registo de auditoria só de acrescentar.
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt" DESC);
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt" DESC);
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt" DESC);

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Só de acrescentar: recusa alterar ou apagar linhas. Protege de erros e de código da aplicação; NÃO protege de
-- quem seja dono da tabela (pode desativar o trigger), por isso é "à prova de adulteração acidental", não "inviolável".
CREATE FUNCTION "audit_event_imutavel"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent é só de acrescentar (% recusado)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_sem_update_delete"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "audit_event_imutavel"();
