# Fase E0: API pública, eventos e segredos (plano, 2026-11-11)

Primeira fase do [sistema de extensões e API pública](plano-extensoes-e-api.md) (decisões E1–E7 já tomadas). Plano escrito antes de qualquer alteração. Cada pacote é um PR independente; só avança depois do anterior estar integrado.

## Os pacotes

| Pacote | Entrega | Risco para os dados | Estado |
|---|---|---|---|
| **E0a — Segredos em repouso** | Cifrar `EmailAccount.password` e `ZadarmaAccount.apiSecret` (hoje em claro); guardar só o *hash* do token de recuperação de password; teste estrutural que impede segredos novos em claro | **Baixo, mas com migração de valores reais** (ver abaixo) | **a fazer agora** |
| **E0b — Registo de auditoria** | Tabela só de acrescentar (`AuditEvent`): quem fez o quê e quando (utilizadores, módulos, definições, chaves); serviço único de escrita | Nenhum (só acrescenta) | depois |
| **E0c — Chaves de API e `/api/v1`** | Chaves por integração (hash, âmbitos, expiração, revogação, limite por chave), guard próprio, `Idempotency-Key`, formato de erros único | Nenhum | depois |
| **E0d — Eventos de domínio e webhooks** | Bus de eventos, subscrições com assinatura HMAC, repetição com recuo, registo de entregas | Nenhum | depois |
| **E0e — OpenAPI e `LigaçãoExterna`** | Especificação OpenAPI gerada, cliente TypeScript, tabela de ligação a ids externos | Nenhum | depois |

Ordem justificada: as chaves de API (E0c) e os segredos dos webhooks (E0d) são **segredos** (precisam do E0a) e a sua criação/revogação tem de ser **auditada** (E0b).

---

## Pacote E0a — Segredos em repouso

### O que está em claro hoje
| Onde | O quê | Quem lê |
|---|---|---|
| `EmailAccount.password` | password SMTP/IMAP da caixa | `EmailService` (envio) |
| `ZadarmaAccount.apiSecret` | segredo da API Zadarma | `ZadarmaService` (assinar pedidos) |
| `User.resetToken` | token de recuperação de password, válido 1 h | `AuthService.resetPassword` |

Quem consiga ler a base de dados (uma cópia de segurança, um *dump*, um acesso indevido) fica com as credenciais de email e telefonia e, durante a janela de 1 h, com contas de utilizador. O resto já está bem: passwords e *refresh tokens* têm `bcrypt`. O `email-worker` lê as suas credenciais do ambiente, não da base de dados.

### Decisões de desenho
1. **Cifra autenticada AES-256-GCM** (`node:crypto`, sem dependências novas). Formato do valor guardado: `enc:v1:<base64url(iv ‖ etiqueta ‖ cifrado)>`. O prefixo permite distinguir cifrado de legado em claro e mudar de formato no futuro.
2. **Chave `SECRETS_KEY`** no ambiente (nunca na base de dados): qualquer texto com **mínimo 32 caracteres**; a chave AES deriva-se com HKDF-SHA256. Em produção o backend **recusa arrancar** se faltar, for curta ou começar por `changeme` (acrescenta-se à verificação que já existe para `JWT_SECRET`). Gera-se com `openssl rand -base64 32`.
3. **Dados associados (AAD) = `Tabela.campo`**: um valor cifrado para `ZadarmaAccount.apiSecret` não decifra se for copiado para outro campo. Impede troca de segredos entre campos por quem tenha escrita na base de dados.
4. **Compatível com legado:** um valor **sem** prefixo `enc:v1:` é tratado como segredo em claro (com um aviso no registo) e passa a cifrado na próxima escrita ou com o comando de migração. A aplicação **não deixa de funcionar** entre a atualização do código e a migração dos valores.
5. **Migração dos valores existentes: comando explícito e idempotente** `pnpm --filter backend secrets:encrypt` (SQL não consegue cifrar sem a chave). Cifra o que estiver em claro, ignora o que já está cifrado, e **recifra** o que estiver cifrado com a chave anterior. Na arrancada, o backend **avisa** quantos segredos ainda estão em claro.
6. **Rotação de chave:** `SECRETS_KEY_PREVIOUS` opcional; decifra-se com a atual e, se falhar, com a anterior; `secrets:encrypt` recifra tudo com a atual. Sem a chave certa o valor **não** se decifra e o erro diz qual o campo (nunca o valor).
7. **Cifra explícita nos serviços**, não «mágica» no Prisma: `EmailService` e `ZadarmaService` (e o *seed*) usam o `SecretsService`. É mais fácil de auditar e de testar.
8. **Token de recuperação de password:** guarda-se o **SHA-256** do token (o token tem 256 bits aleatórios, `bcrypt` seria desnecessário); o email leva o token em claro, a comparação é pelo *hash*. A coluna passa a `resetTokenHash`. **Os pedidos de recuperação pendentes são invalidados** pela migração (duram 1 h; basta pedir outro).
9. **Teste estrutural:** percorre o `schema.prisma` e falha se aparecer um campo com nome tipo `password|secret|token|apiKey` que não esteja na lista de segredos cifrados (`SECRET_FIELDS`) nem numa lista curta de exceções justificadas (`passwordHash`, `refreshToken` — ambos já `bcrypt`). Um segredo novo em claro faz falhar o CI.

### O que **não** muda
- As respostas da API (a Zadarma já nunca devolve `apiKey`/`apiSecret`; o email nunca expõe a password).
- `JWT_SECRET`, `INTERNAL_API_KEY` e credenciais do MinIO continuam no ambiente.
- O `email-worker` (lê do ambiente).

### Operação (a documentar)
- **A chave é tão importante como a base de dados e tem de ser guardada à parte** (gestor de passwords): **uma cópia de segurança da base de dados sem a chave não recupera as credenciais** (têm de ser reintroduzidas). Atualizar `plano-backups.md` e o README com isto.
- `docker-compose.yml` passa `SECRETS_KEY` ao backend e ao serviço de migração/comando; `.env.example` ganha `SECRETS_KEY` e `SECRETS_KEY_PREVIOUS`.

### Testes e validação
- **Unitários:** ida-e-volta; valores diferentes dão cifrados diferentes (IV aleatório); adulterar um byte falha; chave errada falha; **AAD trocado falha**; legado em claro devolve o valor; rotação com a chave anterior; validação da chave (curta, `changeme`, em falta em produção).
- **E2E (Postgres real):** guardar a conta Zadarma → na base de dados o `apiSecret` começa por `enc:v1:` e **não** contém o segredo; a assinatura dos pedidos continua correta (chamada simulada); `GET` continua sem devolver segredos; envio de email lê a password decifrada; recuperação de password: na base de dados há só o *hash*, o token do email funciona, o token reutilizado/expirado falha.
- **Comando `secrets:encrypt`:** corre sobre uma base com valores em claro → ficam cifrados; segunda execução não altera nada (idempotente); com a chave anterior recifra.
- **Estrutural:** o teste do ponto 9; **prova por mutação** (remover a cifra no `saveAccount` e ver o teste e2e falhar).
- **Migração com dados reais:** correr sobre uma cópia da base de desenvolvimento com uma conta de email/Zadarma e confirmar que o sistema continua a enviar/ler.

### Riscos
| Risco | Mitigação |
|---|---|
| **Perder a chave** = perder as credenciais guardadas | Documentado; credenciais reintroduzíveis; chave anterior suportada |
| Atualizar o código sem correr o comando deixa valores em claro | Compatível com legado + aviso na arrancada + passo no guia de atualização |
| Rotação mal feita deixa valores indecifráveis | O comando só grava depois de decifrar com sucesso; falha por campo sem alterar o resto |
| Falsa sensação de segurança | A cifra protege **cópias da base de dados**, não um atacante com o ambiente do backend (que tem a chave). Escrito no documento de segurança |

## Pacote E0c — Chaves de API e `/api/v1` (plano, 2026-11-11)

Base de tudo o que é «forma A» do [sistema de extensões](plano-extensoes-e-api.md): conectores de lojas, formulários, faturação e o n8n falam com o CRM por aqui, com credenciais **próprias** e de **âmbito limitado**, nunca com a sessão de uma pessoa.

### O que entra (e o que fica de fora)
- **Dentro:** chaves de API (criar, listar, revogar), guard próprio, âmbitos, limite por chave, idempotência, formato de erros único, política de versões, e **um conjunto mínimo de rotas reais** para provar o enquadramento: `GET /api/v1/ping`, leitura de empresas e contactos (cursor + `updated_since`) e `POST /api/v1/leads` (o caso típico de um formulário do site, que usa a idempotência).
- **Fora (pacotes seguintes):** eventos e webhooks de saída (E0d), OpenAPI gerada e `LigaçãoExterna` (E0e), encomendas/produtos (módulos futuros). **Regra de dois:** não se desenham mais rotas públicas «por antecipação»; cada módulo novo acrescenta as suas à `v1`.

### Decisões de desenho
1. **Formato da chave:** `ocrm_` + 43 caracteres aleatórios (256 bits, base64url). Mostra-se **uma só vez**, ao criar. Na base de dados guarda-se só o **SHA-256** (a chave é aleatória e longa, por isso um hash rápido chega; `bcrypt` seria lento sem ganho) e um **prefixo** de 8 caracteres para o reconhecer na lista. Procura por hash com índice único.
2. **Separação total das duas portas:** rotas `/api/v1` aceitam **só** chave de API (`Authorization: Bearer ocrm_…`); rotas da interface aceitam **só** JWT. Uma chave nunca abre a API da interface e um JWT nunca abre a `/api/v1`. Teste estrutural: toda a rota `/api/v1` tem `ApiKeyGuard` + `@Scopes(...)` e **nenhuma** tem `JwtAuthGuard`.
3. **Âmbitos** declarados num registo único em código (`companies:read`, `contacts:read`, `leads:write`; cada módulo novo junta os seus). Criar uma chave com um âmbito desconhecido dá 400. Âmbito em falta → 403 (`insufficient_scope`, sem dizer que âmbitos existem).
4. **Estados:** chave revogada, expirada ou inexistente → o mesmo **401** (não revela qual). `lastUsedAt` atualiza-se no máximo uma vez por minuto (não escreve na base de dados a cada pedido).
5. **Limite por chave** (por omissão 120 pedidos/min, configurável 1–1000): janela deslizante em memória (uma só instância do backend, como já está documentado) → `429` com `Retry-After`. Pedidos recusados por falta de chave não consomem o limite de nenhuma chave (limitados por IP pelo limite global já existente).
6. **Idempotência** (`Idempotency-Key`, em todo o `POST`; **obrigatória** em `POST /api/v1/leads`): a primeira chamada grava um registo `(chave de API, Idempotency-Key)` **antes** de executar; repetir o mesmo pedido devolve a **mesma resposta** guardada com o cabeçalho `Idempotent-Replayed: true`; a mesma `Idempotency-Key` com um corpo **diferente** dá `422` (`idempotency_key_reuse`); um pedido igual **ainda em curso** dá `409`. Registos duram 24 h (limpeza diária). Escopo por chave de API: duas integrações podem usar o mesmo texto sem colidir.
7. **Erros:** `{ "error": { "code", "message", "details?" } }` com códigos estáveis (`invalid_request`, `unauthorized`, `insufficient_scope`, `not_found`, `conflict`, `idempotency_key_reuse`, `rate_limited`, `internal_error`). Só na `/api/v1`; a API da interface mantém o formato atual.
8. **Paginação e sincronização:** cursor opaco (`createdAt`/`updatedAt`+`id`), `limit` 1–100, `updated_since` (ISO 8601) para sincronizar só o que mudou. Resposta `{ data: [...], next_cursor }`.
9. **Forma pública estável:** as rotas `/api/v1` devolvem uma representação **escolhida à mão** (não o modelo da base de dados), para uma mudança interna não quebrar integrações. Campos só se **acrescentam** dentro da `v1`.
10. **Política de versões:** dentro da `v1` só se acrescenta (campos, rotas, valores de enumerações **com aviso**); remover ou mudar o sentido exige `v2` e um período de descontinuação anunciado com cabeçalhos `Deprecation`/`Sunset`. Escrita em `docs/api-publica.md`.
11. **Auditoria (E0b):** criar e revogar chaves são ações auditadas (`api_key.created`, `api_key.revoked`, com nome, âmbitos, expiração; nunca a chave). Só o Administrador gere chaves.
12. **Efeitos dos pedidos de escrita:** `POST /api/v1/leads` faz o mesmo que criar um lead na interface (tarefa «Contactar lead», webhook `lead.created`, atualização em tempo real), com `source` por omissão `API: <nome da chave>` e a tarefa atribuída ao **utilizador que criou a chave** (uma chave não é uma pessoa). Respeita o interruptor do módulo de leads (`404` se estiver desligado).
13. **Tempo real:** o interceptor de tempo real passa a reconhecer `/api/v1/<recurso>` (hoje veria «api» e a interface não atualizaria a lista de leads criada por uma integração).
14. **Interface:** Configurações > **Chaves de API** (Administrador): lista (nome, prefixo, âmbitos, última utilização, expiração, estado), criar (nome, âmbitos, expiração opcional, limite) com a chave mostrada uma vez e botão de copiar, revogar.

### Testes e validação
- **Unitários:** geração/hash/formato da chave, registo de âmbitos, limitador por janela, cursor, mapeadores públicos.
- **E2E:** chave válida/revogada/expirada/inexistente/formato errado (todas 401 iguais); JWT em `/api/v1` → 401 e chave na API da interface → 401; âmbito em falta → 403; limite por chave → 429 com `Retry-After`; idempotência (repetição devolve o mesmo, corpo diferente 422, concorrência 409, outra chave não colide); paginação por cursor e `updated_since`; formato de erros; módulo de leads desligado → 404; efeitos do `POST /leads` (tarefa, atribuição, `source`); a chave nunca aparece em respostas de listagem nem na auditoria; só o Administrador gere chaves.
- **Estruturais:** o ponto 2; as rotas de gestão de chaves têm `@Audit`; classificação de módulos dos controllers novos.
- **Prova por mutação:** remover a verificação de revogação, a de âmbito e a de corpo diferente na idempotência.
- **Browser:** criar uma chave, copiá-la, usá-la com `curl`, ver a lista, revogar e confirmar que deixa de funcionar.

### Riscos
| Risco | Mitigação |
|---|---|
| **Chave em `http://` (sem TLS) é legível na rede** | Documentado; HTTPS é pré-requisito para expor integrações fora da máquina (backlog já existente). A chave só abre o âmbito que lhe deram |
| Limite em memória perde-se ao reiniciar | Aceitável (só abranda abusos); uma só instância |
| Idempotência com pedido a meio e crash do backend | O registo «em curso» expira (5 min) para a chamada poder ser repetida |
| Superfície pública a crescer sem controlo | Regra de dois + política de versões + teste de que todas as rotas têm âmbito |
| Chave de quem saiu da empresa | Chaves não pertencem a pessoas: revogam-se na página; a tarefa de lead vai para o criador (que pode ser reatribuída) |

## Pacote E0b — Registo de auditoria (feito, 2026-11-11)

### Desenho (como implementado)
- **Tabela `AuditEvent`** (quem, nome no momento, ação, tipo e id do alvo, detalhes JSON, IP, data) **só de acrescentar**: um *trigger* na migração recusa `UPDATE` e `DELETE`, mesmo por SQL direto. **Limite assumido:** quem for dono da tabela pode desativar o *trigger* — protege de erros e de código da aplicação, não de um administrador da base de dados. O `TRUNCATE` não é bloqueado (os testes e2e precisam dele).
- **Rotas de administração marcadas com `@Audit("recurso.acao", { target, fields, presence })`** e um interceptor global que regista **depois** de o pedido ter sido bem-sucedido (pedidos recusados por permissões, validação ou erro não são registados). O interceptor **espera** pela escrita para o evento já existir quando o cliente recebe o sucesso.
- **Lista branca de campos:** só os campos listados em `fields` do corpo do pedido vão para os detalhes, nunca o corpo todo. `presence` regista apenas que um grupo de campos foi enviado (ex.: `credenciais: "alteradas"` na conta Zadarma, sem os valores). Defesa em profundidade: o serviço remove qualquer chave com nome `password|secret|token|apikey|authorization` mesmo que alguém a ponha na lista.
- **Teste estrutural:** toda a rota de escrita **só do Administrador** tem de ter `@Audit`; um endpoint de administração novo sem decisão faz falhar o CI. As ações têm formato `recurso.acao` e não se repetem.
- **O que é registado:** utilizadores (criar, alterar papel/estado/nome/email, password definida pelo Administrador), módulos, conta Zadarma, funis e fases, campos personalizados, automações; eventos de autenticação (password alterada pelo próprio, recuperação pedida, password redefinida); e o comando `secrets:encrypt` (ação do sistema, só contagens). **Não é registado** (decisão): trabalho do dia-a-dia (empresas, tarefas, negócios...), logins, leituras.
- **API:** `GET /audit` (só Administrador; sem rotas de escrita), paginação por cursor (`createdAt`, `id`, com desempate), filtros por prefixo da ação, utilizador, alvo e intervalo de datas. **Interface:** Configurações > Auditoria.
- **Falha a registar não desfaz a ação:** `record()` nunca lança; o erro fica no registo da aplicação. **Limite assumido:** o evento não é gravado na mesma transação da ação, por isso uma falha entre as duas pode perder o evento.
- **Um utilizador que aparece no registo não pode ser apagado** (a chave estrangeira impede): consistente com a regra de desativar em vez de eliminar.

### Validação
- 186 unitários e 249 e2e a passar; build do frontend OK.
- **Prova por mutação:** retirar `@Audit` de uma rota faz falhar o teste estrutural; pôr `password` na lista branca **e** desligar o filtro de segredos faz falhar o e2e de utilizadores.
- **Browser** (backend real, base de desenvolvimento): a página lista o evento de sistema, o filtro por tipo mostra-o em «Segredos» e o estado vazio em «Utilizadores». A migração aplicou-se na base de desenvolvimento.
- **Não testado no browser:** «Carregar mais» (coberto só pelo e2e da API), filtros por pessoa e datas, e um utilizador não administrador a tentar abrir a página (coberto pelos testes de permissões e pelo e2e do `GET /audit`: 403).
- **Não resolvido:** não há política de conservação (o registo cresce indefinidamente); a decidir mais tarde.

## Execução do pacote E0a (2026-11-11)

- **Implementado como planeado**, com um desvio: o comando vive em `src/cli/encrypt-secrets.ts` (compila para `dist/cli/`, para correr dentro do contentor de produção, que não tem `ts-node`); o script de desenvolvimento usa `node --env-file-if-exists=.env -r ts-node/register`.
- **Testes novos:** unitários da cifra, estrutural do schema, `SECRETS_KEY` em produção, e 10 e2e. Suite completa: 178 unitários e 232 e2e a passar.
- **Prova por mutação:** removida a cifra em cada caminho de escrita da Zadarma, removida a decifra no envio de email e na assinatura dos pedidos, e removido o hash do token → os testes falham em todos. A mutação revelou **uma falha no meu próprio teste** (a atualização do segredo da Zadarma não verificava que o valor novo ficava cifrado, e um valor em claro também passava por ser tratado como legado); corrigida.
- **Migração com dados reais** (base de desenvolvimento, 1 conta de email em claro): a migração SQL aplicou-se, o comando cifrou 1 valor, a segunda execução não alterou nada, e a decifra funciona. **Não testado:** envio de um email real com a password decifrada (só com SMTP simulado), nem a rotação de chave com dados reais (só e2e).
- **Fora do âmbito:** `MINIO_SECRET_KEY`, `JWT_*` e `INTERNAL_API_KEY` continuam no ambiente (não estão na base de dados).

## Registo de execução
- [x] E0a — Segredos em repouso (ver «Execução» abaixo)
- [x] E0b — Registo de auditoria (ver «Pacote E0b» abaixo)
- [ ] E0c — Chaves de API e `/api/v1`
- [ ] E0d — Eventos de domínio e webhooks
- [ ] E0e — OpenAPI e `LigaçãoExterna`
