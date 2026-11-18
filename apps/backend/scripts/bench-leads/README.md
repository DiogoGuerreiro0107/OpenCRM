# Teste de carga das leads (Fase 1a)

Compara as duas formas de guardar leads (A: duas tabelas + `UNION ALL`; B: uma tabela com tipo) com 200 000 leads
sintéticas. Resultados e decisão: [docs/plano-fase-1-leads.md](../../../../docs/plano-fase-1-leads.md) («Resultado do 1a»).

**Só numa base de dados temporária** (o medidor recusa um URL sem «bench» no nome). Com o Postgres do `docker compose`:

```bash
docker exec opencrm-postgres-1 psql -U opencrm -d postgres -c "CREATE DATABASE opencrm_bench_leads"
docker exec -i opencrm-postgres-1 psql -U opencrm -d opencrm_bench_leads -v ON_ERROR_STOP=1 -q < scripts/bench-leads/setup.sql
node scripts/bench-leads/run.cjs "postgresql://opencrm:changeme@localhost:5432/opencrm_bench_leads?schema=public"
docker exec -i opencrm-postgres-1 psql -U opencrm -d opencrm_bench_leads -q < scripts/bench-leads/extra.sql
docker exec opencrm-postgres-1 psql -U opencrm -d postgres -c "DROP DATABASE opencrm_bench_leads"
```

- `setup.sql` — cria as duas formas com **exatamente os mesmos dados** (gerados com `setseed`, reprodutíveis) e os índices previstos (compostos + `pg_trgm`). Demora ~1 min.
- `run.cjs` — 3 aquecimentos + 20 medições por consulta com `EXPLAIN (ANALYZE)` (tempo dentro do Postgres, sem rede); confirma que A e B devolvem os mesmos resultados; aplica o critério fixado antes de medir.
- `extra.sql` — forma A otimizada à mão (ordenar e limitar em cada tabela antes de juntar) e o efeito de um índice `(responsável, estado)` nas contagens.
