-- Teste de carga das leads (Fase 1a, docs/plano-fase-1-leads.md).
-- Cria, numa base de dados TEMPORÁRIA, as duas formas de guardar as leads com OS MESMOS DADOS:
--   A: duas tabelas (lead_company + lead_person), a página usa UNION ALL;
--   B: uma tabela (lead_b) com o tipo numa coluna.
-- Dados sintéticos e reprodutíveis (setseed). Nunca correr na base de dados real.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP TABLE IF EXISTS lead_b, lead_company, lead_person;

SELECT setseed(0.42);

-- ---------- B: uma tabela ----------
CREATE TABLE lead_b (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL,             -- COMPANY | PERSON
  name            text NOT NULL,
  company_name    text,
  email           text,
  phone           text,
  tax_id          text,
  job_title       text,
  status          text NOT NULL,
  owner_id        int,
  next_action_at  timestamptz,
  -- Ordenação «próxima ação primeiro, sem data no fim» precisa de uma chave sem NULL para a paginação por cursor.
  next_action_sort timestamptz GENERATED ALWAYS AS (coalesce(next_action_at, 'infinity'::timestamptz)) STORED,
  created_at      timestamptz NOT NULL,
  notes           text
);

WITH
  first_names AS (SELECT ARRAY['Ana','João','Maria','Pedro','Rita','Miguel','Sofia','Tiago','Inês','Rui','Carla','Nuno','Marta','Paulo','Joana','Luís','Teresa','Bruno','Helena','Diogo'] AS a),
  last_names  AS (SELECT ARRAY['Silva','Santos','Ferreira','Pereira','Oliveira','Costa','Rodrigues','Martins','Jesus','Sousa','Fernandes','Gonçalves','Gomes','Lopes','Marques','Alves','Almeida','Ribeiro','Pinto','Carvalho','Teixeira','Moreira','Correia','Mendes','Nunes','Soares','Vieira','Monteiro','Cardoso','Rocha'] AS a),
  suffixes    AS (SELECT ARRAY['Lda','SA','Unipessoal Lda','& Filhos Lda','Comércio Lda','Serviços SA'] AS a),
  rows AS (
    SELECT
      g,
      random() AS r_kind, random() AS r_status, random() AS r_next, random() AS r_company,
      (SELECT a FROM first_names)[1 + floor(random() * 20)::int] AS first_name,
      (SELECT a FROM last_names)[1 + floor(random() * 30)::int] AS last_name,
      (SELECT a FROM last_names)[1 + floor(random() * 30)::int] AS company_word,
      (SELECT a FROM suffixes)[1 + floor(random() * 6)::int] AS suffix,
      1 + floor(random() * 10)::int AS owner_id,
      now() + (random() * 120 - 60) * interval '1 day' AS next_at,
      now() - random() * 365 * interval '1 day' AS created_at
    FROM generate_series(1, 200000) AS g
  )
INSERT INTO lead_b (kind, name, company_name, email, phone, tax_id, job_title, status, owner_id, next_action_at, created_at, notes)
SELECT
  CASE WHEN r_kind < 0.5 THEN 'COMPANY' ELSE 'PERSON' END,
  first_name || ' ' || last_name,
  CASE WHEN r_kind < 0.5 OR r_company < 0.4 THEN company_word || ' ' || suffix END,
  lower(translate(first_name || '.' || last_name, 'ãáàâçéêíóôõú', 'aaaaceeiooou')) || g || '@exemplo.pt',
  '9' || lpad((g * 7919 % 100000000)::text, 8, '0'),
  CASE WHEN r_kind < 0.5 THEN (500000000 + g)::text END,
  CASE WHEN r_kind >= 0.5 THEN (ARRAY['Diretor','Compras','Gerente','Administrativo','Técnico'])[1 + (g % 5)] END,
  CASE WHEN r_status < 0.35 THEN 'NOVO' WHEN r_status < 0.65 THEN 'CONTACTADO' WHEN r_status < 0.80 THEN 'SEM_RESPOSTA'
       WHEN r_status < 0.90 THEN 'CONVERTIDO' ELSE 'PERDIDO' END,
  owner_id,
  CASE WHEN r_next < 0.7 THEN next_at END,
  created_at,
  NULL
FROM rows;

CREATE INDEX lead_b_status_owner_next ON lead_b (status, owner_id, next_action_sort, id);
CREATE INDEX lead_b_status_next ON lead_b (status, next_action_sort, id);
CREATE INDEX lead_b_next ON lead_b (next_action_sort, id);
CREATE INDEX lead_b_kind_status ON lead_b (kind, status);
CREATE INDEX lead_b_search ON lead_b USING gin ((coalesce(name,'') || ' ' || coalesce(company_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,'')) gin_trgm_ops);

-- ---------- A: duas tabelas, com exatamente as mesmas linhas ----------
CREATE TABLE lead_company AS
  SELECT id, name, company_name, email, phone, tax_id, status, owner_id, next_action_at, created_at, notes FROM lead_b WHERE kind = 'COMPANY';
CREATE TABLE lead_person AS
  SELECT id, name, company_name, email, phone, job_title, status, owner_id, next_action_at, created_at, notes FROM lead_b WHERE kind = 'PERSON';

ALTER TABLE lead_company ADD PRIMARY KEY (id), ADD COLUMN next_action_sort timestamptz GENERATED ALWAYS AS (coalesce(next_action_at, 'infinity'::timestamptz)) STORED;
ALTER TABLE lead_person  ADD PRIMARY KEY (id), ADD COLUMN next_action_sort timestamptz GENERATED ALWAYS AS (coalesce(next_action_at, 'infinity'::timestamptz)) STORED;

CREATE INDEX lead_company_status_owner_next ON lead_company (status, owner_id, next_action_sort, id);
CREATE INDEX lead_company_status_next ON lead_company (status, next_action_sort, id);
CREATE INDEX lead_company_next ON lead_company (next_action_sort, id);
CREATE INDEX lead_company_search ON lead_company USING gin ((coalesce(name,'') || ' ' || coalesce(company_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,'')) gin_trgm_ops);
CREATE INDEX lead_person_status_owner_next ON lead_person (status, owner_id, next_action_sort, id);
CREATE INDEX lead_person_status_next ON lead_person (status, next_action_sort, id);
CREATE INDEX lead_person_next ON lead_person (next_action_sort, id);
CREATE INDEX lead_person_search ON lead_person USING gin ((coalesce(name,'') || ' ' || coalesce(company_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,'')) gin_trgm_ops);

VACUUM ANALYZE lead_b;
VACUUM ANALYZE lead_company;
VACUUM ANALYZE lead_person;

SELECT kind, status, count(*) FROM lead_b GROUP BY ROLLUP (kind, status) ORDER BY 1, 2;
