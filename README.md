# OpenCRM

CRM interno inspirado no Bitrix24, para uso na rede local da Globaltoner. Ver [CLAUDE.md](./CLAUDE.md) para a visão geral do projeto, stack, roadmap e decisões de arquitetura.

> **Nota:** este projeto foi desenvolvido em regime de *vibe coding* com o [Claude Code](https://claude.com/claude-code) (modelo Claude Sonnet 5).

## Arranque rápido (desenvolvimento)

Pré-requisitos: Node.js 20+, pnpm, Docker + Docker Compose.

```bash
pnpm install
pnpm dev
```

O comando `pnpm dev`:
1. Cria os ficheiros `.env` (raiz, `apps/backend`, `apps/frontend`) a partir dos `.env.example` correspondentes, se ainda não existirem
2. Arranca o PostgreSQL via Docker Compose e espera que fique saudável (`docker compose up -d --wait postgres`)
3. Aplica migrações Prisma pendentes (`prisma migrate deploy`)
4. Arranca o backend (`http://localhost:3000`) e o frontend (`http://localhost:5173`) em paralelo, com logs prefixados `[backend]`/`[frontend]`

Outros comandos úteis:

```bash
pnpm dev:setup      # só os passos 1-3 acima, sem arrancar os servidores
pnpm dev:backend    # só o backend
pnpm dev:frontend   # só o frontend
pnpm stop           # pára o container do PostgreSQL
```

Para criar uma nova migração depois de alterar `apps/backend/prisma/schema.prisma`, corre `npx prisma migrate dev --name <nome>` dentro de `apps/backend` (o `pnpm dev` só aplica migrações já criadas, não gera novas).

Há três ficheiros `.env`: o da raiz alimenta o `docker-compose.yml`; os de `apps/backend` e `apps/frontend` são usados quando esses serviços correm localmente via `pnpm` (o Prisma e o Vite carregam automaticamente o `.env` da própria pasta).

Utilizador inicial criado pelo seed: `admin@globaltoner.local` / `admin123` (papel `ADMIN`). Corre `pnpm --filter backend prisma:seed` depois do primeiro `pnpm dev` para o criar.

## Estrutura

```
apps/
  backend/         NestJS API (auth JWT+refresh, RBAC, Prisma)
                    módulos: users, companies, contacts, activity-log, pipelines, deals
  frontend/        React + Vite + Tailwind + shadcn/ui
                    páginas: login, empresas, contactos, funis (kanban)
  email-worker/    Sincronização IMAP/SMTP (Fase 4, ainda por implementar)
packages/
  shared-types/    Tipos TypeScript partilhados
scripts/
  dev-setup.mjs    Usado por 'pnpm dev' — ver secção de arranque rápido
```

## Roadmap

Ver secção 7 de [CLAUDE.md](./CLAUDE.md) para a descrição completa de cada fase.

Estado atual: **Fases 0, 1 e 2 concluídas.**

- [x] Fase 0 — Setup do monorepo, Docker Compose, autenticação JWT + RBAC
- [x] Fase 1 — Contactos/Empresas + histórico de atividades
- [x] Fase 2 — Funis de vendas / Kanban (Pipelines, Stages, Deals, drag-and-drop)
- [ ] Fase 3 — Tarefas e Calendário
- [ ] Fase 4 — Integração de Email (IMAP/SMTP)
- [ ] Fase 5 — Automações (webhooks para n8n)
- [ ] Fase 6 — Relatórios e Dashboards

Decisões de arquitetura de cada fase em [docs/decisoes.md](docs/decisoes.md).
