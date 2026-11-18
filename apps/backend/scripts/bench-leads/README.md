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

## Medição da API (Fase 1c)

Mede por HTTP, com a aplicação compilada, os pedidos que a página das leads faz (`GET /leads/page` e `GET /leads/counts`)
com 200 000 leads: validação, guardas, Prisma, Postgres e JSON. Resultados em
[docs/plano-fase-1-leads.md](../../../../docs/plano-fase-1-leads.md) («Execução do pacote 1c»).

```bash
pnpm --filter backend build
docker exec opencrm-postgres-1 psql -U opencrm -d postgres -c "CREATE DATABASE opencrm_bench_api"
DATABASE_URL="postgresql://opencrm:changeme@localhost:5432/opencrm_bench_api?schema=public" pnpm --filter backend exec prisma migrate deploy
docker exec -i opencrm-postgres-1 psql -U opencrm -d opencrm_bench_api -v ON_ERROR_STOP=1 -q < scripts/bench-leads/api-seed.sql
node scripts/bench-leads/api.cjs "postgresql://opencrm:changeme@localhost:5432/opencrm_bench_api?schema=public"
docker exec opencrm-postgres-1 psql -U opencrm -d postgres -c "DROP DATABASE opencrm_bench_api"
```

- `api-seed.sql` — 10 comerciais e 200 000 leads (60% de empresa, 30% sem próxima ação), reprodutíveis. ~1,5 min.
- `api.cjs` — arranca a aplicação no próprio processo (porta aleatória, segredos descartáveis, sem webhooks), com o
  limitador global desligado **só nesse processo** (senão media o limitador); 3 aquecimentos + 20 medições por pedido.
- No Windows os tempos aparecem em degraus de ~15,6 ms (resolução do relógio do sistema): o valor real é menor.
