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

## Execução do pacote E0a (2026-11-11)

- **Implementado como planeado**, com um desvio: o comando vive em `src/cli/encrypt-secrets.ts` (compila para `dist/cli/`, para correr dentro do contentor de produção, que não tem `ts-node`); o script de desenvolvimento usa `node --env-file-if-exists=.env -r ts-node/register`.
- **Testes novos:** unitários da cifra, estrutural do schema, `SECRETS_KEY` em produção, e 10 e2e. Suite completa: 178 unitários e 232 e2e a passar.
- **Prova por mutação:** removida a cifra em cada caminho de escrita da Zadarma, removida a decifra no envio de email e na assinatura dos pedidos, e removido o hash do token → os testes falham em todos. A mutação revelou **uma falha no meu próprio teste** (a atualização do segredo da Zadarma não verificava que o valor novo ficava cifrado, e um valor em claro também passava por ser tratado como legado); corrigida.
- **Migração com dados reais** (base de desenvolvimento, 1 conta de email em claro): a migração SQL aplicou-se, o comando cifrou 1 valor, a segunda execução não alterou nada, e a decifra funciona. **Não testado:** envio de um email real com a password decifrada (só com SMTP simulado), nem a rotação de chave com dados reais (só e2e).
- **Fora do âmbito:** `MINIO_SECRET_KEY`, `JWT_*` e `INTERNAL_API_KEY` continuam no ambiente (não estão na base de dados).

## Registo de execução
- [x] E0a — Segredos em repouso (ver «Execução» abaixo)
- [ ] E0b — Registo de auditoria
- [ ] E0c — Chaves de API e `/api/v1`
- [ ] E0d — Eventos de domínio e webhooks
- [ ] E0e — OpenAPI e `LigaçãoExterna`
