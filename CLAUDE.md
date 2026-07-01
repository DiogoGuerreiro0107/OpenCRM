# CRM Interno — Instruções de Arranque do Projeto

> Documento de referência para iniciar o desenvolvimento com o **Claude Code**. Guarda este ficheiro na raiz do repositório (idealmente renomeado para `CLAUDE.md`) para que o Claude Code o leia automaticamente como contexto persistente do projeto.

---

## 1. Visão geral

Sistema de CRM interno, inspirado no Bitrix24, para uso na rede local da Globaltoner. Objetivo: centralizar contactos, funis de vendas, tarefas, email e relatórios, com automações que podem tirar partido da infraestrutura n8n já existente.

**Acesso:** apenas rede local (sem exposição à internet). Equivalente ao modelo do n8n self-hosted já em produção.

---

## 2. Módulos funcionais (âmbito da V1)

| Módulo | Descrição | Entidades principais |
|---|---|---|
| **Contactos/Empresas** | Ficha de contacto e empresa, histórico completo de interações (chamadas, emails, notas, ficheiros) | `Contact`, `Company`, `ActivityLog` |
| **Funis de vendas (Kanban)** | Múltiplos funis configuráveis, fases arrastáveis, valor e probabilidade por negócio | `Pipeline`, `Stage`, `Deal` |
| **Tarefas e calendário** | Tarefas associadas a contactos/negócios, prazos, lembretes, vista de calendário | `Task`, `Reminder` |
| **Caixa de email integrada** | Sincronização IMAP/SMTP, associação automática de emails a contactos, envio direto do CRM | `EmailAccount`, `EmailMessage`, `Attachment` |
| **Automações** | Regras do tipo "quando X acontece → fazer Y" (ex: negócio muda de fase → criar tarefa) | `AutomationRule` — **ou reutilizar o n8n já existente via webhooks** |
| **Relatórios e dashboards** | Taxas de conversão por funil, receita por período, atividade por comercial | vistas agregadas sobre as entidades acima |

**Recomendação prática:** dado o volume de trabalho, sugiro construir por fases (ver secção 7), mesmo que todos os módulos façam parte da visão final da V1.

---

## 3. Stack tecnológica recomendada

Stack pensada para um projeto de maior dimensão e manutenção a longo prazo — arquitetura modular, tipagem forte ponta-a-ponta, e reaproveitamento do que já dominas (TypeScript/React, ambiente self-hosted).

| Camada | Tecnologia | Porquê |
|---|---|---|
| **Backend** | Node.js + **NestJS** + TypeScript | Arquitetura modular com injeção de dependências — escala bem para um CRM com muitos domínios (contactos, funis, email, automações). Muito mais estruturado que Express puro à medida que o projeto cresce. |
| **Base de dados** | **PostgreSQL** | Relacional, robusta, suporta bem dados estruturados (contactos, negócios) e campos flexíveis via JSONB (campos customizados, à Bitrix24). |
| **ORM** | **Prisma** | Tipagem automática entre schema e código, migrações versionadas, boa integração com NestJS. |
| **Frontend** | React + Vite + TypeScript | Já usas esta combinação no gerador de propostas — consistência entre projetos. |
| **UI** | TailwindCSS + shadcn/ui | Componentes acessíveis e consistentes, rápidos de montar (tabelas, formulários, modais). |
| **Estado servidor** | TanStack Query (React Query) | Cache e sincronização de dados do backend, essencial num CRM com muitas listas e updates. |
| **Kanban** | dnd-kit | Biblioteca de drag-and-drop mais robusta e leve para React. |
| **Gráficos** | Recharts | Para os dashboards/relatórios. |
| **Autenticação** | JWT + refresh tokens, RBAC (papéis: Admin / Gestor / Comercial) | Controlo de acesso por perfil, como no Bitrix24. |
| **Tempo real** | Socket.io (WebSockets) | Atualizações ao vivo do kanban e notificações, sem necessidade de polling. |
| **Email** | `imapflow` (leitura) + `nodemailer` (envio), como serviço/worker separado | Sincronização de caixas de email associadas a utilizadores. |
| **Ficheiros/anexos** | MinIO (compatível com S3), self-hosted | Armazenamento de anexos sem depender de serviços cloud externos. |
| **Containerização** | Docker + Docker Compose | Facilita deployment na rede local, tal como o n8n. |
| **Controlo de versões** | Git (GitHub privado, ou Gitea self-hosted se preferires manter tudo local) | Histórico e colaboração. |
| **Proxy/rede local** | Nginx (ou Traefik) com domínio interno (ex.: `crm.globaltoner.local`) | Acesso simples via nome em vez de IP:porta. |

**Nota sobre automações:** em vez de construir um motor de automação de raiz, considera que o teu n8n já tem workflows maduros (webhook → Bitrix24 → SMTP). O CRM pode simplesmente disparar webhooks para o n8n em eventos-chave (novo negócio, mudança de fase), poupando bastante trabalho de desenvolvimento.

---

## 4. Arquitetura (visão geral)

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────┐
│  Frontend    │◄────►│  Backend (NestJS) │◄────►│ PostgreSQL   │
│  React/Vite  │ REST │  + WebSockets     │      │ (Prisma)     │
└─────────────┘  +WS  └──────────────────┘      └─────────────┘
                            │        │
                            ▼        ▼
                   ┌────────────┐ ┌──────────────┐
                   │ Email      │ │ MinIO         │
                   │ Worker     │ │ (anexos)      │
                   │ (IMAP/SMTP)│ └──────────────┘
                   └────────────┘
                            │
                            ▼
                     Webhooks → n8n (automações existentes)
```

Tudo corre em Docker Compose num único servidor da rede local, atrás de um Nginx com domínio interno.

---

## 5. Estrutura de pastas sugerida (monorepo)

```
crm/
├── apps/
│   ├── backend/          # NestJS API
│   ├── frontend/         # React + Vite
│   └── email-worker/     # Serviço de sincronização IMAP/SMTP
├── packages/
│   └── shared-types/     # Tipos TypeScript partilhados entre backend e frontend
├── docker-compose.yml
├── .env.example
├── CLAUDE.md             # Este ficheiro, para contexto persistente do Claude Code
└── README.md
```

Gestor de pacotes recomendado: **pnpm** com workspaces (mais rápido e eficiente em monorepos que npm/yarn).

---

## 6. Modelo de dados inicial (entidades principais)

- `User`, `Role`
- `Company`, `Contact`
- `Pipeline`, `Stage`, `Deal`
- `Task`, `Reminder`
- `EmailAccount`, `EmailMessage`, `Attachment`
- `ActivityLog` (timeline unificada de interações)
- `AutomationRule` (ou apenas referência a webhooks do n8n)

---

## 7. Roadmap de implementação por fases

| Fase | Objetivo |
|---|---|
| **0** | Setup do monorepo, Docker Compose (Postgres + backend + frontend), autenticação básica (login, papéis) |
| **1** | Módulo Contactos/Empresas + histórico de atividades |
| **2** | Módulo Funis/Kanban (Pipelines, Stages, Deals, drag-and-drop) |
| **3** | Módulo Tarefas e Calendário |
| **4** | Integração de Email (IMAP/SMTP, associação a contactos) |
| **5** | Automações — webhooks para o n8n existente (ou motor interno, se necessário) |
| **6** | Relatórios e Dashboards |

Recomendo pedir ao Claude Code para implementar **uma fase de cada vez**, validando antes de avançar.

---

## 8. Prompt de arranque para o Claude Code

Copia o texto abaixo como primeira mensagem ao abrir o Claude Code na pasta do projeto:

```
Vamos construir um CRM interno inspirado no Bitrix24, para uso apenas em rede local.

Stack:
- Backend: Node.js + NestJS + TypeScript + Prisma + PostgreSQL
- Frontend: React + Vite + TypeScript + TailwindCSS + shadcn/ui + TanStack Query + dnd-kit
- Autenticação: JWT + refresh tokens + RBAC (Admin / Gestor / Comercial)
- Tempo real: Socket.io
- Monorepo gerido com pnpm workspaces (apps/backend, apps/frontend, apps/email-worker, packages/shared-types)
- Tudo containerizado com Docker Compose (sem exposição à internet, só rede local)

Começa pela Fase 0:
1. Estrutura do monorepo com pnpm workspaces
2. docker-compose.yml com PostgreSQL, backend e frontend
3. Setup do NestJS com módulo de autenticação (JWT + RBAC básico com 3 papéis)
4. Setup do Prisma com schema inicial: User, Role
5. Setup do frontend em React/Vite com Tailwind e shadcn/ui, com página de login funcional

Explica cada decisão estrutural à medida que avanças e confirma comigo antes de passar à fase seguinte.
```

---

## 9. Passos práticos antes de abrir o Claude Code

1. Instalar: Docker + Docker Compose, Node.js LTS, pnpm (`npm install -g pnpm`)
2. Criar o repositório Git (GitHub privado, ou Gitea local se preferires manter tudo dentro da rede)
3. Criar a pasta do projeto e guardar este ficheiro como `CLAUDE.md` na raiz
4. Dentro da pasta, correr `claude` para iniciar a sessão
5. Colar o prompt de arranque da secção 8

---

## 10. Notas adicionais

- Como já usas o Bitrix24 atualmente, vale a pena manter uma folha de mapeamento de campos (Bitrix24 → novo CRM) para facilitar uma eventual migração de dados de clientes existentes.
- O `email-worker` pode nascer mais simples (leitura de uma única caixa partilhada, `info@globaltoner.pt`) e evoluir depois para múltiplas contas por utilizador.
- Vale a pena documentar decisões de arquitetura num ficheiro `docs/decisoes.md` à medida que o projeto avança, para que o Claude Code mantenha contexto entre sessões longas.
