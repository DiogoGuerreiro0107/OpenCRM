# Plano: gestão de utilizadores pela UI (2026-11-06)

Hoje só existe `GET /users` (lista resumida para dropdowns). Os utilizadores criam-se por seed ou SQL, e agora que os 6 papéis têm efeito real ([plano de endurecimento](plano-endurecimento.md)) isso passou a ser um bloqueio: o Administrador não consegue criar um Comercial, mudar o papel de alguém, desativar quem saiu da empresa, nem repor uma password esquecida quando o email falha. Plano escrito antes de qualquer alteração.

## 1. Funcionalidades

**Administrador** (página Configurações > Utilizadores)
- Listar todos os utilizadores (nome, email, papel, estado)
- Criar utilizador (nome, email, papel, password inicial)
- Editar nome e papel; ativar/desativar
- Definir uma nova password a outro utilizador (a sessão dele é terminada)

**Qualquer utilizador**
- Alterar a **própria** password (pede a atual; termina as outras sessões)

## 2. Decisões

| Decisão | Porquê |
|---|---|
| **Desativar em vez de eliminar** (`User.active`) | Os utilizadores estão ligados a negócios, tarefas, leads, empresas, contactos e à timeline; eliminar apagaria ou impediria o histórico. Desativado: não entra, não aparece nos dropdowns, mas o histórico mantém o nome. Migração: `active Boolean DEFAULT true` (utilizadores existentes ficam ativos) |
| **O papel e o estado são lidos da base de dados em cada pedido** (`JwtStrategy.validate`), não do token | Hoje o papel vem no JWT: mudar o papel ou desativar alguém só teria efeito ao fim de 15 minutos (validade do token). Para uma pessoa que saiu da empresa isso não serve. Custo: uma consulta por pedido, aceitável a esta escala |
| **Proteções contra ficar sem acesso** | Ninguém pode desativar nem despromover **a si próprio**; tem de existir sempre pelo menos **um Administrador ativo** |
| **Nunca devolver** `passwordHash`, `refreshToken` nem `resetToken` | `select` explícito, como nas outras entidades sensíveis |
| **Password mínima de 8 caracteres** | Igual à recuperação de password existente |
| Email duplicado → `409 Conflict` | Em vez de um 500 do Prisma |
| `GET /users` (dropdowns) passa a listar só utilizadores ativos | Não se atribui trabalho a quem já não está |
| Login/refresh/recuperação de password recusados a utilizadores desativados | Sem email de recuperação para desativados (não revela que existem) |

## 3. API (todas as de escrita só para o Administrador, via `@WriteRoles`; o teste estrutural já garante que não ficam sem política)

| Rota | Quem | |
|---|---|---|
| `GET /users` | todos | resumo dos **ativos** (como hoje) |
| `GET /users/manage` | Administrador | lista completa com estado e data de criação |
| `POST /users` | Administrador | criar |
| `PATCH /users/:id` | Administrador | nome, papel, ativo |
| `POST /users/:id/password` | Administrador | definir nova password |
| `POST /auth/change-password` | autenticado | alterar a própria (atual + nova); em `/auth/*`, por isso também disponível a `LEITURA_APENAS` |

## 4. Frontend
- Página `/configuracoes/utilizadores` (só Administrador, `RequireRole` + item no menu): tabela, diálogo criar/editar, diálogo de nova password. Os erros do backend (email duplicado, "último administrador", …) aparecem como mensagem em vez do genérico "não foi possível guardar".
- Botão "Alterar password" no rodapé do menu lateral (todos os papéis).

## 5. Testes
- **Unitários** (Prisma simulado): regras de proteção (próprio utilizador, último administrador), email duplicado.
- **E2E** (Postgres real): criar utilizador e ele consegue entrar; não-administrador recebe 403 em tudo; **desativar** → o login falha **e o token que já tinha deixa de funcionar de imediato**; **mudar o papel** → permissões mudam de imediato; não se pode despromover/desativar o último administrador nem a si próprio; email duplicado → 409; nenhuma resposta contém hashes/tokens; alterar password (atual errada → recusada, certa → a antiga deixa de entrar).
- Browser: criar um utilizador pela UI e entrar com ele.

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Ler a BD em cada pedido muda o `JwtStrategy` para todas as rotas | A suite e2e existente (159 testes, 6 papéis × todas as rotas) corre contra a mudança |
| Migração em bases existentes | Coluna nova com `DEFAULT true`: nada a migrar; o `migrate` do Docker aplica-a sozinho |
| Ficar sem nenhum administrador | Regras acima + teste |

## 7. Fora de âmbito
Eliminar utilizadores definitivamente, convites por email, política de passwords mais complexa, autenticação de dois fatores, registo de auditoria de quem mudou o quê.

## 8. Registo de execução

- [x] Backend (schema + migração, serviço, rotas, JwtStrategy)
- [x] Testes unitários e e2e (90 + 181)
- [x] Frontend
- [x] Validação no browser
- [ ] PR
