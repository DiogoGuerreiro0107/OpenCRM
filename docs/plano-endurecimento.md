# Plano: endurecimento de segurança, permissões reais e testes (2026-11-06)

Plano escrito **antes** de qualquer alteração, a partir da revisão do estado da aplicação (todas as fases do roadmap concluídas). As decisões tomadas durante a execução ficam registadas em `docs/decisoes.md`; este ficheiro é o plano e o registo de execução.

## 1. Problemas que este plano resolve

| # | Problema encontrado na revisão | Pacote |
|---|---|---|
| 1 | `pnpm audit --prod`: 89 vulnerabilidades (2 críticas, 40 altas) em `axios`, `nodemailer`, `multer`, `body-parser`, `follow-redirects`, `proxy-addr`, `lodash`, `tar`, … | A |
| 2 | CORS aceita qualquer origem; sem `helmet`; sem rate limiting (login exposto a força bruta) | A |
| 3 | Os 6 papéis existem mas só `LEITURA_APENAS` tem efeito: o `@Roles()` não é usado em nenhum controller | B |
| 4 | Zero testes automáticos e zero CI; o script `lint` aponta para um ESLint que não está instalado | C |

Fora de âmbito (ficam no backlog): Socket.io/tempo real, Nginx e domínio interno, ferramenta de migração do Bitrix24, produtos/orçamentos, importação/exportação CSV, cópias de segurança, gestão de utilizadores pela UI (hoje só existe `GET /users`).

## 2. Fluxo de trabalho

- Um único ramo `chore/endurecimento-seguranca-testes`, **um commit por pacote** (A → B → C), para ser revisto commit a commit.
- Cada pacote só é commitado depois de build + validação (testes quando existirem).
- Um único PR. **Não é feito merge automático**: fica à espera de revisão do utilizador.
- Nenhuma alteração ao schema Prisma → nenhuma migração nova neste plano.

## 3. Pacote A — Dependências e segurança HTTP

**A1. Dependências**
- Atualizar as dependências diretas vulneráveis (`axios`, `nodemailer`, `@nestjs/*` dentro do mesmo major) e usar `overrides` do pnpm para as transitivas (`multer`, `body-parser`, `follow-redirects`, `proxy-addr`, `lodash`, `tar`, `brace-expansion`, `linkify-it`, `ip-address`, `deepmerge-ts`).
- Não saltar de major em pacotes centrais (NestJS 10, Prisma 5, React 18) — o risco de regressão não compensa para uma rede local.
- Critério de saída: `pnpm audit --prod` sem **críticas** e sem **altas** com correção disponível; o que sobrar fica documentado com o motivo.

**A2. Segurança HTTP (backend)**
- `helmet` com `crossOriginResourcePolicy: cross-origin` (o frontend noutra porta consome a API).
- `@nestjs/throttler`: limite global generoso (300 pedidos/min/IP) + limite estrito em `POST /auth/login` e `POST /auth/forgot-password` (5/min/IP). `POST /email/ingest` (email-worker) fica isento.
- CORS: deixa de aceitar qualquer origem. Aceita (a) origens listadas em `CORS_ORIGINS` (lista separada por vírgulas) e (b) por omissão, origens cujo host é `localhost` ou um IP de rede privada (10.x, 172.16–31.x, 192.168.x) ou `*.local`. Mantém o acesso por IP a partir de outros computadores da rede (decisão "IP-based" do utilizador) e bloqueia origens públicas. Novas variáveis: `CORS_ORIGINS` (opcional).
- Arranque falha em `NODE_ENV=production` se `JWT_SECRET`, `JWT_REFRESH_SECRET` ou `INTERNAL_API_KEY` ainda tiverem o valor `changeme_*` do `.env.example`.

## 4. Pacote B — Permissões por papel (RBAC real)

**Modelo:** leitura aberta a qualquer utilizador autenticado (CRM interno, equipa pequena); **escrita** (POST/PATCH/PUT/DELETE) controlada por papel. Exceções de leitura: `automation-rules` e `zadarma/account` (configuração) só para o Administrador.

Matriz de escrita proposta (ajustável num único ficheiro, `auth/permissions.ts`):

| Recurso | ADMIN | COMERCIAL | TÉCNICO | BACKOFFICE | FINANCEIRO | LEITURA |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Empresas | ✅ | ✅ | – | ✅ | ✅ | – |
| Contactos | ✅ | ✅ | – | ✅ | – | – |
| Leads | ✅ | ✅ | – | ✅ | – | – |
| Negócios (deals) | ✅ | ✅ | – | ✅ | – | – |
| Tarefas | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| Timeline (notas) | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| Valores de campos personalizados | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| Enviar email | ✅ | ✅ | – | ✅ | – | – |
| Ligar (Zadarma click-to-call) | ✅ | ✅ | ✅ | ✅ | – | – |
| Templates de email | ✅ | – | – | ✅ | – | – |
| Funis e fases (estrutura) | ✅ | – | – | – | – | – |
| Definição de campos personalizados | ✅ | – | – | – | – | – |
| Regras de automação | ✅ | – | – | – | – | – |
| Conta Zadarma (credenciais) | ✅ | – | – | – | – | – |

**Implementação**
- Novo decorador `@WriteRoles(...roles)` (nível de classe ou método; o método sobrepõe a classe) que só se aplica a pedidos que alteram dados; o `@Roles()` existente mantém o significado "restringe todos os métodos".
- `RolesGuard` passa a tratar os dois e é adicionado a todos os controllers como `@UseGuards(JwtAuthGuard, RolesGuard)` (um guard global não funcionaria: corre antes do `JwtAuthGuard`, sem `request.user`).
- **Fail-closed:** um pedido de escrita autenticado numa rota sem `@WriteRoles` é recusado (403) — impede que uma rota nova fique aberta por esquecimento. Rotas `/auth/*` e `POST /email/ingest` (chave interna) ficam fora disto.
- O bloqueio de `LEITURA_APENAS` no `JwtAuthGuard` mantém-se como segunda barreira.
- Frontend: o `AuthContext` já tem `user.role`; um helper `canAccess(role, área)` esconde no menu lateral as páginas de Configurações restritas ao Administrador. É só conforto de UX — a segurança é a do backend.

## 5. Pacote C — Testes e CI

**C1. Unitários (Jest + ts-jest, sem base de dados)**
- `RolesGuard` e `JwtAuthGuard` (cada papel × leitura/escrita).
- **Teste estrutural:** percorre os controllers e falha se existir alguma rota de escrita sem política (garante o fail-closed do pacote B para rotas futuras).
- Lógica pura: assinatura HMAC da Zadarma (extraída para função pura), `normalizePhone`, avaliação de condições das automações, substituição de variáveis nos templates (se estiver no backend).

**C2. Integração/e2e (Jest + supertest, Postgres real, schema de teste)**
- Arranca o `AppModule` contra `DATABASE_URL` de teste, aplica `prisma migrate deploy`, cria um utilizador por papel.
- Cenários: login (ok / password errada / rate limit); matriz de permissões por HTTP (amostra por papel); conversão de lead → empresa + contacto + negócio; automação `FIELD_CHANGED` a mover um negócio; `LEITURA_APENAS` bloqueado em escrita.

**C3. CI (GitHub Actions)**
- Job único com serviço Postgres: `pnpm install --frozen-lockfile` → build de tudo → testes unitários → migrate + e2e → `pnpm audit --prod --audit-level=critical`.
- `lint`: o script existe mas o ESLint não está instalado. Decisão: **remover o script morto** em vez de adicionar uma configuração de lint agora (fica no backlog); o `tsc` do build já apanha erros de tipos.

## 6. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Atualização de dependências parte o build | Build + arranque + smoke test via API após o pacote A; commit só se passar |
| `pnpm install` bloqueia o motor do Prisma no Windows (EPERM) com os servidores a correr | Parar os servidores de preview antes de instalar e voltar a levantá-los depois |
| CORS restritivo corta o acesso de outros computadores da rede | Regra de redes privadas por omissão + `CORS_ORIGINS`; testado com a origem `http://192.168.50.10:5173` |
| Matriz de papéis não corresponde ao que a Globaltoner quer | Está num único ficheiro e é só uma proposta — a confirmar pelo utilizador no PR |
| Rate limit afeta o uso normal | Limite global alto; só o login/recuperação são estritos; `email/ingest` isento |

## 7. Registo de execução

_(preenchido à medida que cada pacote é concluído)_

- [ ] A — Dependências e segurança HTTP
- [ ] B — Permissões por papel
- [ ] C — Testes e CI
- [ ] PR aberto para revisão
