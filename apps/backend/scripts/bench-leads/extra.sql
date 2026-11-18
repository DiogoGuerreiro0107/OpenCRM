-- Medições complementares do teste de carga (Fase 1a): forma A OTIMIZADA (ordenar e limitar dentro de cada tabela
-- antes de juntar — a forma justa de a comparar) e um índice extra para as contagens por responsável na forma B.
-- Correr com: psql -f extra.sql (mostra só os tempos do EXPLAIN ANALYZE). Executar 3 vezes e ler a última.
\pset pager off

\echo '== A otimizada: separador (estado + responsável), 1.ª página'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON)
SELECT * FROM (
  (SELECT id, next_action_sort FROM lead_company WHERE status = 'NOVO' AND owner_id = 3 ORDER BY next_action_sort, id LIMIT 50)
  UNION ALL
  (SELECT id, next_action_sort FROM lead_person WHERE status = 'NOVO' AND owner_id = 3 ORDER BY next_action_sort, id LIMIT 50)
) u ORDER BY next_action_sort, id LIMIT 50;

\echo '== A otimizada: todos os tipos por próxima ação, 1.ª página'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON)
SELECT * FROM (
  (SELECT id, next_action_sort FROM lead_company ORDER BY next_action_sort, id LIMIT 50)
  UNION ALL
  (SELECT id, next_action_sort FROM lead_person ORDER BY next_action_sort, id LIMIT 50)
) u ORDER BY next_action_sort, id LIMIT 50;

\echo '== A otimizada: pesquisa «silva», 1.ª página'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON)
SELECT * FROM (
  (SELECT id, next_action_sort FROM lead_company WHERE (coalesce(name,'') || ' ' || coalesce(company_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,'')) ILIKE '%silva%' ORDER BY next_action_sort, id LIMIT 50)
  UNION ALL
  (SELECT id, next_action_sort FROM lead_person WHERE (coalesce(name,'') || ' ' || coalesce(company_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,'')) ILIKE '%silva%' ORDER BY next_action_sort, id LIMIT 50)
) u ORDER BY next_action_sort, id LIMIT 50;

\echo '== B: contagens de um responsável SEM índice (owner_id, status)'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON)
SELECT status, count(*) FROM lead_b WHERE owner_id = 3 GROUP BY status;

CREATE INDEX IF NOT EXISTS lead_b_owner_status ON lead_b (owner_id, status);
ANALYZE lead_b;

\echo '== B: contagens de um responsável COM índice (owner_id, status)'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON)
SELECT status, count(*) FROM lead_b WHERE owner_id = 3 GROUP BY status;

\echo '== B: contagens (todas) — referência'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON)
SELECT status, count(*) FROM lead_b GROUP BY status;

DROP INDEX lead_b_owner_status;
