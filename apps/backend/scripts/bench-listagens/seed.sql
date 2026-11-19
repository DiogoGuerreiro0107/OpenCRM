-- Medição das listagens paginadas (docs/plano-paginacao-listagens.md) numa base TEMPORÁRIA já migrada.
-- Volumes de «muitos anos» numa só instalação. Reprodutível (setseed). Ver README.md.
SELECT setseed(0.42);

INSERT INTO "User" ("id", "email", "name", "passwordHash", "role", "updatedAt")
SELECT 'bench-user-' || i, 'bench' || i || '@bench.invalid', 'Comercial ' || i, '-', 'COMERCIAL', now()
FROM generate_series(1, 10) AS i;

-- 100 000 empresas (nomes repetidos de propósito: a chave do cursor desempata pelo id).
INSERT INTO "Company" ("id", "name", "taxId", "email", "status", "ownerId", "updatedAt")
SELECT 'bench-co-' || i,
  (ARRAY['Gráfica','Papelaria','Informática','Escritório','Tipografia','Livraria','Copiadora','Toner','Office','Print'])[1 + floor(random() * 10)::int]
    || ' ' || (ARRAY['São João','Lisboa','Porto','Braga','Faro','Évora','Coimbra','Setúbal','Aveiro','Viseu'])[1 + floor(random() * 10)::int]
    || ' ' || (i % 5000),
  (500000000 + i)::text, 'geral' || i || '@empresa.pt',
  (ARRAY['ATIVO','POTENCIAL','INATIVO','PERDIDO'])[1 + floor(random() * 4)::int]::"CompanyStatus",
  'bench-user-' || (1 + floor(random() * 10)::int), now()
FROM generate_series(1, 100000) AS i;

-- 200 000 contactos; a empresa 1 tem 2 000 (empresa grande, para a ficha).
INSERT INTO "Contact" ("id", "name", "email", "phone", "companyId", "updatedAt")
SELECT 'bench-ct-' || i,
  (ARRAY['Ana','Rui','Marta','João','Inês','Pedro','Sofia','Tiago','Rita','Nuno'])[1 + floor(random() * 10)::int] || ' '
    || (ARRAY['Silva','Santos','Ferreira','Pereira','Oliveira','Costa','Rodrigues','Martins','Sousa','Fernandes'])[1 + floor(random() * 10)::int],
  'contacto' || i || '@exemplo.pt', (910000000 + i)::text,
  CASE WHEN i <= 2000 THEN 'bench-co-1' ELSE 'bench-co-' || (1 + (i % 100000)) END, now()
FROM generate_series(1, 200000) AS i;

-- 200 000 tarefas (20% sem prazo; prazos repetidos ao minuto para haver empates).
INSERT INTO "Task" ("id", "title", "description", "status", "priority", "dueDate", "assigneeId", "companyId", "createdAt", "updatedAt")
SELECT gen_random_uuid(),
  (ARRAY['Ligar','Enviar proposta','Visita','Cobrança','Assistência'])[1 + floor(random() * 5)::int] || ' ' || i,
  'Tarefa de ensaio ' || i,
  (ARRAY['PENDING','IN_PROGRESS','DONE','DONE'])[1 + floor(random() * 4)::int]::"TaskStatus",
  'NORMAL',
  CASE WHEN random() < 0.2 THEN NULL ELSE date_trunc('minute', now() - interval '3 years' + random() * interval '4 years') END,
  'bench-user-' || (1 + floor(random() * 10)::int), 'bench-co-' || (1 + floor(random() * 100000)::int),
  now() - random() * interval '3 years', now()
FROM generate_series(1, 200000) AS i;

-- Um funil com 4 fases; 150 000 negócios, 100 000 deles na fase «Ganho» (coluna enorme).
INSERT INTO "Workflow" ("id", "entityType", "name", "updatedAt") VALUES ('bench-pipe', 'DEAL', 'Vendas', now());
INSERT INTO "WorkflowStep" ("id", "name", "order", "category", "outcome", "workflowId") VALUES
  ('bench-st-1', 'Novo', 0, 'OPEN', NULL, 'bench-pipe'),
  ('bench-st-2', 'Proposta enviada', 1, 'OPEN', NULL, 'bench-pipe'),
  ('bench-st-3', 'Ganho', 2, 'DONE', 'WON', 'bench-pipe'),
  ('bench-st-4', 'Perdido', 3, 'DONE', 'LOST', 'bench-pipe');
INSERT INTO "Deal" ("id", "title", "value", "order", "pipelineId", "stageId", "companyId", "ownerId", "updatedAt")
SELECT gen_random_uuid(), 'Negócio ' || i, round((random() * 5000)::numeric, 2), i,
  'bench-pipe',
  CASE WHEN i <= 100000 THEN 'bench-st-3' ELSE 'bench-st-' || (1 + (i % 2)) END,
  'bench-co-' || (1 + floor(random() * 100000)::int), 'bench-user-' || (1 + floor(random() * 10)::int), now()
FROM generate_series(1, 150000) AS i;

-- 200 000 emails na caixa partilhada.
INSERT INTO "EmailAccount" ("id", "email", "imapHost", "imapPort", "smtpHost", "smtpPort", "username", "password", "updatedAt")
VALUES ('bench-mail', 'caixa@bench.invalid', 'imap.bench.invalid', 993, 'smtp.bench.invalid', 465, 'caixa', '-', now());
INSERT INTO "EmailMessage" ("id", "accountId", "direction", "messageId", "fromAddress", "toAddresses", "subject", "sentAt")
SELECT gen_random_uuid(), 'bench-mail', 'INBOUND', '<bench-' || i || '@bench.invalid>', 'cliente' || i || '@exemplo.pt', ARRAY['caixa@bench.invalid'],
  (ARRAY['Orçamento','Encomenda','Fatura','Assistência técnica','Pedido de informação'])[1 + floor(random() * 5)::int] || ' ' || i,
  now() - random() * interval '5 years'
FROM generate_series(1, 200000) AS i;

-- Histórico: 50 000 entradas numa só empresa (cliente muito antigo) + 150 000 espalhadas.
INSERT INTO "TimelineEvent" ("id", "entityType", "entityId", "userId", "type", "description", "createdAt")
SELECT gen_random_uuid(), 'COMPANY', CASE WHEN i <= 50000 THEN 'bench-co-1' ELSE 'bench-co-' || (1 + floor(random() * 100000)::int) END,
  'bench-user-1', 'NOTE', 'Nota ' || i, now() - random() * interval '5 years'
FROM generate_series(1, 200000) AS i;

-- 100 000 chamadas.
INSERT INTO "CallRecord" ("id", "externalId", "direction", "fromNumber", "toNumber", "startedAt")
SELECT gen_random_uuid(), 'bench-call-' || i, 'INBOUND', (910000000 + i)::text, '210000000', now() - random() * interval '3 years'
FROM generate_series(1, 100000) AS i;

ANALYZE;
