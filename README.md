# OpenCRM

CRM interno inspirado no Bitrix24, para uso na rede local da Globaltoner. Ver [CLAUDE.md](./CLAUDE.md) para a visão geral do projeto, stack, roadmap e decisões de arquitetura.

> **Nota:** este projeto foi desenvolvido em regime de *vibe coding* com o [Claude Code](https://claude.com/claude-code) (modelo Claude Sonnet 5).

## Arranque rápido (desenvolvimento)

Pré-requisitos: Node.js 20+, pnpm, Docker + Docker Compose.

```bash
cp .env.example .env
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
pnpm install
docker compose up -d postgres
pnpm --filter backend prisma:migrate
pnpm --filter backend prisma:seed
pnpm dev:backend    # http://localhost:3000
pnpm dev:frontend   # http://localhost:5173
```

Há três ficheiros `.env`: o da raiz alimenta o `docker-compose.yml`; os de `apps/backend` e `apps/frontend` são usados quando esses serviços correm localmente via `pnpm` (o Prisma e o Vite carregam automaticamente o `.env` da própria pasta).

Utilizador inicial criado pelo seed: `admin@globaltoner.local` / `admin123` (papel `ADMIN`).

## Estrutura

```
apps/
  backend/         NestJS API (auth JWT+refresh, RBAC, Prisma)
  frontend/         React + Vite + Tailwind + shadcn/ui
  email-worker/    Sincronização IMAP/SMTP (Fase 4)
packages/
  shared-types/    Tipos TypeScript partilhados
```

## Roadmap

Ver secção 7 de [CLAUDE.md](./CLAUDE.md). Estado atual: **Fase 0 concluída** (monorepo, Docker Compose, autenticação básica).
