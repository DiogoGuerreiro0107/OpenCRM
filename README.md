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

Utilizador inicial criado pelo seed: `admin@globaltoner.local` / `admin123` (papel `ADMINISTRADOR`). Corre `pnpm --filter backend prisma:seed` depois do primeiro `pnpm dev` para o criar. Os restantes utilizadores criam-se na própria aplicação, em **Configurações > Utilizadores** (só o Administrador): criar, mudar o papel, desativar e definir uma nova password. Cada utilizador pode alterar a sua password no botão "Alterar password" do menu lateral.

## Estrutura

```
apps/
  backend/         NestJS API (auth JWT+refresh, RBAC, Prisma)
                    módulos: users, companies, contacts, timeline, pipelines, deals, tasks, email, email-templates, leads, custom-fields, webhooks, automations, dashboard, zadarma, integrations (só contratos)
  frontend/        React + Vite + Tailwind + shadcn/ui
                    páginas: login, dashboard, leads, empresas, contactos, funis (kanban), tarefas (lista + calendário), email, configurações
  email-worker/    Sincronização IMAP (imapflow + mailparser), fala com o backend por HTTP
packages/
  shared-types/    Tipos TypeScript partilhados
scripts/
  dev-setup.mjs    Usado por 'pnpm dev' — ver secção de arranque rápido
```

## Cópias de segurança e restauro

O `docker compose up -d` arranca também o serviço `backup`: faz uma cópia ao arrancar e depois a cada 24 h, para a pasta `./backups/` do servidor — `db/opencrm-AAAAMMDD-HHMMSS.dump` (base de dados) e `files/minio-AAAAMMDD-HHMMSS.tar.gz` (anexos dos emails). Mantém 14 dias e verifica cada cópia depois de a fazer (uma cópia ilegível é descartada e o erro fica nos logs). Configurável no `.env`: `BACKUP_DIR`, `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP_DAYS`.

```bash
docker compose run --rm backup list                      # cópias existentes
docker compose run --rm backup once                      # fazer uma cópia agora
```

**Restaurar** (substitui os dados atuais — o comando recusa-se a avançar sem `--yes`):

```bash
docker compose stop backend email-worker
docker compose run --rm backup restore opencrm-20261106-120000.dump --yes
docker compose up -d
```

Para restaurar também os anexos, pára o MinIO (`docker compose stop minio`) e junta `--files minio-20261106-120000.tar.gz` (usa o ficheiro do mesmo carimbo). Um ficheiro corrompido é recusado **antes** de tocar em qualquer dado, e se o restauro falhar a meio a base de dados atual fica como estava.

Três coisas que tens de saber:
- **Uma cópia no mesmo disco não protege de uma avaria desse disco.** Aponta `BACKUP_DIR` a outro disco ou a uma partilha de rede.
- As cópias **não são cifradas** e contêm dados pessoais e hashes de passwords: protege a pasta. Também **não incluem o `.env`** (tem os segredos) — guarda-o à parte, por exemplo num gestor de passwords; sem ele não consegues pôr a aplicação a funcionar a partir das cópias.
- Uma cópia que nunca foi restaurada é uma esperança, não uma cópia: experimenta o restauro de vez em quando num servidor de teste.

## Testes

```bash
pnpm test        # unitários (Jest, sem base de dados) — guards, permissões, segurança HTTP, assinatura Zadarma
pnpm test:e2e    # e2e (Jest + supertest) contra um Postgres real; precisa do PostgreSQL a correr (pnpm dev:setup)
```

Os testes e2e usam uma base de dados **separada**, `opencrm_test`, que criam e migram sozinhos no mesmo servidor Postgres (podes mudar com `TEST_DATABASE_URL`). **Apagam todos os dados dessa base entre cenários, por isso recusam correr contra qualquer base cujo nome não contenha "test"** — os teus dados reais nunca são tocados. Cobrem: login e limite anti força-bruta, cabeçalhos/CORS, a matriz de permissões por papel (6 papéis × todas as rotas de escrita), conversão de leads, motor de automações e proteção dos eventos de sistema na timeline.

O CI (GitHub Actions, `.github/workflows/ci.yml`) corre build + unitários + e2e + auditoria de dependências em cada PR.

## Arranque em produção (Docker)

Corre tudo (Postgres, MinIO, migrações, backend, email-worker e frontend) em contentores, sem `pnpm` instalado no servidor:

```bash
cp .env.example .env     # e edita-o (ver abaixo)
docker compose up -d --build
docker compose run --rm -e SEED_ADMIN_PASSWORD="<uma password forte>" migrate pnpm --filter backend prisma:seed   # só na 1.ª vez
```

No `.env` tens de definir, antes de arrancar:

- **Segredos novos** (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_API_KEY`, `MINIO_SECRET_KEY`, `POSTGRES_PASSWORD`). O backend corre com `NODE_ENV=production` e **recusa arrancar** se ainda tiverem o valor `changeme_*` de exemplo.
- **O endereço do servidor visto pelos browsers**, nunca `localhost` se outros computadores acedem: `VITE_API_URL` (ex.: `http://192.168.50.10:3000`), `MINIO_PUBLIC_URL` (`http://192.168.50.10:9000`, usado nos links de download de anexos) e `FRONTEND_URL` (links do email de recuperação de password). **`VITE_API_URL` é embutido no frontend na compilação**: se o mudares, volta a correr `docker compose up -d --build`.
- As credenciais de email (`EMAIL_*`, `IMAP_*`, `SMTP_*`) se quiseres a caixa de email.

O `migrate` corre sozinho em cada arranque e aplica as migrações pendentes antes do backend subir. Depois de atualizar o código: `git pull && docker compose up -d --build`. A base de dados (`127.0.0.1:5432`) e a consola do MinIO (`127.0.0.1:9001`) só são acessíveis a partir do próprio servidor; o frontend (5173), a API (3000) e o MinIO (9000) ficam na rede local.

## Roadmap

Ver secção 7 de [CLAUDE.md](./CLAUDE.md) para a descrição original de cada fase, e "Roadmap consolidado" no mesmo ficheiro para a versão revista (mais papéis, mais campos, Leads, Campos Personalizados, timeline genérica, etc.).

Estado atual: **todas as fases do roadmap consolidado e a revisão final concluídas**.

- [x] Fase 0 — Setup do monorepo, Docker Compose, autenticação JWT + RBAC
- [x] Fase 1 — Contactos/Empresas + histórico de atividades
- [x] Fase 1.5 — Leads (CRUD + conversão para Empresa/Contacto/Oportunidade)
- [x] Fase 2 — Funis de vendas / Kanban (Pipelines, Stages, Deals, drag-and-drop)
- [x] Fase 2.5 — Campos Personalizados (transversal a Empresas/Contactos/Leads/Oportunidades)
- [x] Fase 3 — Tarefas e Calendário (lista, filtros por estado, vista mensal, lembretes)
- [x] Fase 4 — Integração de Email (IMAP/SMTP, anexos via MinIO, associação automática a contactos/empresas)
- [x] Fase 5 — Automações (webhooks para n8n em eventos-chave + eventos locais na timeline)
- [x] Fase 6 — Dashboard e KPIs (empresas/contactos/leads/oportunidades, valor em aberto, tarefas hoje/atrasadas, negócios parados, gráfico por funil)
- [x] Fase 7 — Estrutura de Integrações Futuras (contratos TypeScript: Bitrix24, Zadarma, Gmail, MS Graph, Mail providers, WhatsApp)
- [x] **Revisão final** — revisões pendentes às Fases 0-4
  - [x] 6 papéis (roles) + restrição de escrita para `LEITURA_APENAS`
  - [x] Campos completos em Empresa/Contacto/Negócio/Tarefa
  - [x] `TimelineEvent` genérico a substituir o `ActivityLog`
  - [x] Templates de email
  - [x] Recuperação de password
- [x] **Pós-revisão** — pedidos adicionais fora do `CLAUDE.md`
  - [x] Gestão de funis/fases (editar/eliminar funil; adicionar/editar/eliminar/reordenar fases)
  - [x] Motor de automações (mover negócios entre fases/funis por tempo parado, tarefas concluídas ou campo alterado; disparo de webhook n8n)
  - [x] Integração Zadarma (click-to-call, histórico de chamadas/gravações por polling periódico — estrutura pronta, por validar com credenciais reais quando existirem)
  - [x] Gestão de utilizadores pela UI (criar, papel, desativar, passwords) — ver [docs/plano-gestao-utilizadores.md](docs/plano-gestao-utilizadores.md)
  - [x] Endurecimento: dependências sem vulnerabilidades altas/críticas, helmet + rate limiting + CORS restrito à rede local, permissões de escrita por papel, testes automáticos (unitários + e2e) e CI — ver [docs/plano-endurecimento.md](docs/plano-endurecimento.md)

Decisões de arquitetura de cada fase em [docs/decisoes.md](docs/decisoes.md).
