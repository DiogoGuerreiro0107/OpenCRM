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

## Fase 1 — Contactos/Empresas + histórico de atividades (2026-07-01)

- Modelo de dados: `Company` 1—N `Contact` (nullable, `onDelete: SetNull` — apagar uma empresa não apaga os seus contactos); `ActivityLog` liga-se opcionalmente a `Contact` e/ou `Company` (`onDelete: Cascade`) e sempre a um `User` autor. Tipo de atividade fixo no enum `ActivityType` (`NOTE`, `CALL`, `EMAIL`, `MEETING`, `FILE`).
- Sem restrição de RBAC por papel nos endpoints de Companies/Contacts/ActivityLog — qualquer utilizador autenticado (`ADMIN`/`GESTOR`/`COMERCIAL`) pode gerir contactos e empresas. `RolesGuard` fica disponível para quando houver necessidade de restringir (ex.: eliminar registos só para `ADMIN`/`GESTOR`).
- Frontend: `AuthContext` guarda o utilizador autenticado e inicializa a sessão a partir do `accessToken` em `localStorage`, validando com `GET /auth/me`; o interceptor do axios (`lib/api.ts`) tenta um refresh automático em qualquer 401 antes de desistir — testado e confirmado a funcionar (access token de 15m expirou durante os testes e a sessão recuperou sem pedir novo login).
- `ActivityTimeline` é um componente partilhado entre a ficha de Contacto e de Empresa (recebe `activities` + `onAdd`), para não duplicar a UI de registo de atividade.
- Página de "Novo contacto" aceita `?companyId=` na URL para pré-selecionar a empresa quando se cria o contacto a partir da ficha da empresa.
- Ainda sem paginação nas listagens (Companies/Contacts) — aceitável para o volume atual, a rever se a lista de contactos crescer muito.

## Fase 2 — Funis de vendas / Kanban (2026-07-01)

- Sem campo `status` redundante no `Deal`. O estado "aberto/ganho/perdido" deriva do `type` da `Stage` onde o negócio está (`StageType`: `OPEN`/`WON`/`LOST`). Mover um negócio para uma fase `WON`/`LOST` define `closedAt` automaticamente no backend (`DealsService.move`/`create`); mover de volta para `OPEN` limpa `closedAt`. Evita ter dois estados (fase + status) que podiam dessincronizar.
- Cada `Pipeline` novo é criado já com 4 fases por omissão (`Novo`, `Em negociação` — `OPEN`; `Ganho` — `WON`; `Perdido` — `LOST`), tanto no seed como no endpoint `POST /pipelines`.
- Ordenação (`order`) em `Stage` e `Deal` é normalizada só na coluna de destino ao mover um negócio (`PATCH /deals/:id/move` recebe `{ stageId, index }` e reatribui `order` sequencial nessa coluna); a coluna de origem fica com gaps nos números, o que não afeta a ordenação relativa.
- Eliminar uma `Stage` com negócios associados é bloqueado (400) — é preciso mover/eliminar os negócios primeiro. Eliminar um `Pipeline` inteiro faz cascade a fases e negócios (ação explícita e destrutiva, âmbito diferente de eliminar só uma fase).
- Kanban implementado com `@dnd-kit/core` + `@dnd-kit/sortable`, seguindo o padrão "multiple containers" documentado pela biblioteca (um `SortableContext` por coluna, coluna também `useDroppable` para permitir largar em coluna vazia).
- Diálogo (`components/ui/dialog.tsx`) construído à mão em vez de trazer `@radix-ui/react-dialog`, para não aumentar dependências só por causa de um modal simples.
- **Nota de teste**: o drag-and-drop foi validado a testar o endpoint `PATCH /deals/:id/move` diretamente (mesma chamada que o `onDragEnd` do Kanban dispara) e confirmando que a UI reflete corretamente o resultado após reload. A simulação de gestos de arrastar via eventos de pointer sintéticos não foi fiável neste ambiente de testing automatizado (browsers restringem `setPointerCapture` a eventos "trusted"/reais), pelo que o gesto de arrastar em si (clique + arrastar com o rato) deve ser confirmado manualmente.
