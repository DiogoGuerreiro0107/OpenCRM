# Medição das listagens paginadas

Mede por HTTP, com a aplicação compilada, as listagens paginadas de
[docs/plano-paginacao-listagens.md](../../../../docs/plano-paginacao-listagens.md): empresas, contactos, tarefas,
calendário, kanban, emails, timeline, chamadas e dashboard, com volumes de «muitos anos» numa só instalação. Resultados
no mesmo documento («Execução»).

Corre a partir de `apps/backend`:

```bash
pnpm --filter backend build
docker exec opencrm-postgres-1 psql -U opencrm -d postgres -c "CREATE DATABASE opencrm_bench_listagens"
DATABASE_URL="postgresql://opencrm:changeme@localhost:5432/opencrm_bench_listagens?schema=public" pnpm --filter backend exec prisma migrate deploy
docker exec -i opencrm-postgres-1 psql -U opencrm -d opencrm_bench_listagens -v ON_ERROR_STOP=1 -q < scripts/bench-listagens/seed.sql
node scripts/bench-listagens/api.cjs "postgresql://opencrm:changeme@localhost:5432/opencrm_bench_listagens?schema=public"
docker exec opencrm-postgres-1 psql -U opencrm -d postgres -c "DROP DATABASE opencrm_bench_listagens"
```

- `seed.sql` (cerca de 4 minutos):
  - 100 000 empresas, com nomes repetidos;
  - 200 000 contactos, 2 000 deles numa só empresa;
  - 200 000 tarefas, 20% sem prazo;
  - um funil com 150 000 negócios, 100 000 numa só coluna;
  - 200 000 emails;
  - 200 000 entradas de timeline, 50 000 numa só empresa;
  - 100 000 chamadas.
- `api.cjs` funciona como o das leads (`../bench-leads`):
  - arranca a aplicação no próprio processo;
  - o limitador global fica desligado **só nesse processo**;
  - faz 3 aquecimentos e 20 medições por pedido;
  - as páginas fundas ficam depois de 200 páginas de 50 linhas (10 000).
- No Windows, os tempos aparecem em degraus de cerca de 15,6 ms (resolução do relógio do sistema); o valor real é menor.
