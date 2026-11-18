-- Medição da API das leads com volume (Fase 1c): 200 000 leads sintéticas numa base TEMPORÁRIA já migrada
-- (prisma migrate deploy). Reprodutível (setseed). Ver README.md («Medição da API»).
SELECT setseed(0.42);

INSERT INTO "User" ("id", "email", "name", "passwordHash", "role", "updatedAt")
SELECT 'bench-user-' || i, 'bench' || i || '@bench.invalid', 'Comercial ' || i, '-', 'COMERCIAL', now()
FROM generate_series(1, 10) AS i;

-- Distribuição parecida com a do teste de carga 1a: maioria por tratar, 30% sem próxima ação, 60% de empresa.
INSERT INTO "Lead" ("id", "kind", "name", "companyName", "taxId", "email", "phone", "status", "responsavelId", "nextActionAt", "updatedAt")
SELECT
  gen_random_uuid(),
  CASE WHEN r1 < 0.6 THEN 'COMPANY'::"LeadKind" ELSE 'PERSON'::"LeadKind" END,
  (ARRAY['Ana','Rui','Marta','João','Inês','Pedro','Sofia','Tiago','Rita','Nuno'])[1 + floor(r2 * 10)::int] || ' '
    || (ARRAY['Silva','Santos','Ferreira','Pereira','Oliveira','Costa','Rodrigues','Martins','Sousa','Fernandes'])[1 + floor(r3 * 10)::int]
    || ' ' || i,
  CASE WHEN r1 < 0.6 THEN 'Empresa ' || i || ' Lda' END,
  CASE WHEN r1 < 0.6 THEN (500000000 + i)::text END,
  'lead' || i || '@exemplo.pt',
  (910000000 + i)::text,
  (ARRAY['NOVO','NOVO','NOVO','CONTACTADO','CONTACTADO','SEM_RESPOSTA','CONVERTIDO','PERDIDO'])[1 + floor(r4 * 8)::int]::"LeadStatus",
  'bench-user-' || (1 + floor(r5 * 10)::int),
  CASE WHEN r6 < 0.3 THEN NULL ELSE now() - interval '180 days' + (r6 * interval '365 days') END,
  now()
FROM (
  SELECT i, random() r1, random() r2, random() r3, random() r4, random() r5, random() r6
  FROM generate_series(1, 200000) AS i
) s;

ANALYZE "Lead";
