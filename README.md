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
1. Cria os ficheiros `.env` (raiz, `apps/backend`, `apps/frontend`, `apps/email-worker`) a partir dos `.env.example` correspondentes, se ainda não existirem
2. Arranca o PostgreSQL e o MinIO via Docker Compose e espera que fiquem saudáveis (`docker compose up -d --wait postgres minio`)
3. Aplica migrações Prisma pendentes (`prisma migrate deploy`)
4. Arranca o backend (`http://localhost:3000`), o frontend (`http://localhost:5173`) e o `email-worker` em paralelo, com logs prefixados `[backend]`/`[frontend]`/`[email-worker]`

Outros comandos úteis:

```bash
pnpm dev:setup        # só os passos 1-3 acima, sem arrancar os servidores
pnpm dev:backend      # só o backend
pnpm dev:frontend     # só o frontend
pnpm dev:email-worker # só o email-worker
pnpm stop             # pára os containers do PostgreSQL e do MinIO
```

Para criar uma nova migração depois de alterar `apps/backend/prisma/schema.prisma`, corre `npx prisma migrate dev --name <nome>` dentro de `apps/backend` (o `pnpm dev` só aplica migrações já criadas, não gera novas).

Há quatro ficheiros `.env`: o da raiz alimenta o `docker-compose.yml`; os de `apps/backend`, `apps/frontend` e `apps/email-worker` são usados quando esses serviços correm localmente via `pnpm` (o Prisma, o Vite e o worker carregam automaticamente o `.env` da própria pasta). **Nota:** valores com `#`, espaços ou aspas devem ser postos entre aspas no `.env` (ex.: `EMAIL_PASSWORD="a#b"`) — sem aspas, o `dotenv` trata `#` como início de comentário e trunca o valor.

O `email-worker` precisa de uma conta de email configurada (`EMAIL_ADDRESS`, `EMAIL_PASSWORD`, `IMAP_HOST`, etc., em `apps/backend/.env` e `apps/email-worker/.env`) para sincronizar mensagens — sem isso, o `pnpm --filter backend prisma:seed` não cria nenhum `EmailAccount` e a caixa de entrada fica vazia.

Utilizador inicial criado pelo seed: `admin@globaltoner.local` / `admin123` (papel `ADMIN`). Corre `pnpm --filter backend prisma:seed` depois do primeiro `pnpm dev` para o criar.

## Estrutura

```
apps/
  backend/         NestJS API (auth JWT+refresh, RBAC, Prisma)
                    módulos: users, companies, contacts, activity-log, pipelines, deals, tasks, email, leads, custom-fields
  frontend/        React + Vite + Tailwind + shadcn/ui
                    páginas: login, leads, empresas, contactos, funis (kanban), tarefas (lista + calendário), email, configurações
  email-worker/    Sincronização IMAP (imapflow + mailparser), fala com o backend por HTTP
packages/
  shared-types/    Tipos TypeScript partilhados
scripts/
  dev-setup.mjs    Usado por 'pnpm dev' — ver secção de arranque rápido
```

## Roadmap

Ver secção 7 de [CLAUDE.md](./CLAUDE.md) para a descrição original de cada fase, e "Roadmap consolidado" no mesmo ficheiro para a versão revista (mais papéis, mais campos, Leads, Campos Personalizados, timeline genérica, etc.).

Estado atual: **Fases 0, 1, 1.5, 2, 2.5, 3 e 4 concluídas** (implementação inicial — as revisões marcadas no `CLAUDE.md` para as Fases 0-4 ficam para uma revisão final, depois de todas as fases estarem construídas).

- [x] Fase 0 — Setup do monorepo, Docker Compose, autenticação JWT + RBAC
- [x] Fase 1 — Contactos/Empresas + histórico de atividades
- [x] Fase 1.5 — Leads (CRUD + conversão para Empresa/Contacto/Oportunidade)
- [x] Fase 2 — Funis de vendas / Kanban (Pipelines, Stages, Deals, drag-and-drop)
- [x] Fase 2.5 — Campos Personalizados (transversal a Empresas/Contactos/Leads/Oportunidades)
- [x] Fase 3 — Tarefas e Calendário (lista, filtros por estado, vista mensal, lembretes)
- [x] Fase 4 — Integração de Email (IMAP/SMTP, anexos via MinIO, associação automática a contactos/empresas)
- [ ] Fase 5 — Automações (webhooks para n8n)
- [ ] Fase 6 — Relatórios e Dashboards
- [ ] Fase 7 — Estrutura de Integrações Futuras (Bitrix24, Zadarma, Gmail, MS Graph, Mail providers)
- [ ] **Revisão final** — aplicar as revisões pendentes às Fases 0-4 (6 papéis, campos completos, timeline genérica, templates de email)

Decisões de arquitetura de cada fase em [docs/decisoes.md](docs/decisoes.md).
