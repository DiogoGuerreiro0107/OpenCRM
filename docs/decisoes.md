# Decisões de arquitetura

## Fase 0 — Setup inicial (2026-07-01)

- Monorepo com **pnpm workspaces** (`apps/backend`, `apps/frontend`, `apps/email-worker`, `packages/shared-types`), conforme `CLAUDE.md`.
- Backend NestJS montado manualmente (sem `nest new` interativo) para controlo total da estrutura dentro do monorepo.
- Autenticação: JWT de acesso (15m) + refresh token (7d) guardado com hash (`bcrypt`) na tabela `User`; estratégias Passport separadas (`jwt`, `jwt-refresh`); `RolesGuard` + decorator `@Roles()` prontos a usar em módulos futuros (ainda não aplicados globalmente).
- RBAC com 3 papéis fixos no enum Prisma `Role`: `ADMIN`, `GESTOR`, `COMERCIAL`.
- Frontend: componentes shadcn/ui (`Button`, `Input`, `Label`, `Card`) criados manualmente (sem CLI `shadcn`), para evitar dependência de rede/config extra nesta fase.
- Seed inicial cria `admin@globaltoner.local` / `admin123` com papel `ADMIN` — **trocar password antes de qualquer exposição além da rede local**.
- `email-worker` existe só como placeholder de package.json (Fase 4).
- Docker/Docker Compose ainda por instalar na máquina de desenvolvimento; `docker-compose.yml` já escrito e não testado (`docker compose up` pendente).
