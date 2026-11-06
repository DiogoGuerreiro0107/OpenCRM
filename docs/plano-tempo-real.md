# Plano: atualizações em tempo real com Socket.io (2026-11-06)

O `CLAUDE.md` original previa "Socket.io: atualizações ao vivo do kanban e notificações, sem necessidade de polling" e nunca foi implementado. Hoje, com várias pessoas a usar o CRM ao mesmo tempo, cada uma só vê o que as outras fizeram quando recarrega a página (o Kanban de duas pessoas diverge, uma tarefa criada por outra não aparece, um email recebido só aparece ao fim de 30 s). Plano escrito antes de qualquer alteração.

## 1. Princípio de desenho: os eventos não levam dados

O servidor avisa só **"mudou alguma coisa em *deals*"**; o browser, ao receber, refaz o pedido HTTP normal. Assim:
- **Não há fuga de dados nem de permissões por WebSocket**: quem recebe o evento só obtém o que a API HTTP já o deixaria ver (a leitura continua sujeita ao `JwtAuthGuard`/papéis). Um evento nunca contém nomes, valores nem ids de negócio.
- Não há segundo caminho de leitura para manter, testar e proteger.
- Custo: um pedido HTTP extra por evento recebido (aceitável a esta escala; com *debounce* no cliente).

## 2. Desenho

**Backend**
- `@nestjs/websockets` + `@nestjs/platform-socket.io` (v10, alinhado com o Nest 10) + `socket.io`; um `RealtimeGateway` e um `RealtimeService.emit(resource, action)`.
- **Autenticação no *handshake***: o cliente envia o token de acesso (`auth.token`); o servidor valida a assinatura e **lê o utilizador na base de dados** (ativo? como no `JwtStrategy`: um utilizador desativado deixa de receber eventos). Sem token válido, a ligação é recusada.
- **CORS do socket com a mesma regra do resto da API** (`isAllowedOrigin`: rede local + `CORS_ORIGINS`; sites públicos recusados).
- **Onde se emite**: um `RealtimeInterceptor` global que, depois de **qualquer pedido de escrita bem-sucedido**, emite `{ resource, action }` (o *resource* é o 1.º segmento do caminho: `deals`, `tasks`, `leads`, `timeline`, …; `/stages/*` conta como `pipelines`). Isto cobre todos os controllers actuais **e os futuros** sem os ter de lembrar. Excluídos: `/auth/*`. Inclui `POST /email/ingest` (chegada de um email novo, chamada pelo email-worker).
- **O que o interceptor não apanha**: alterações feitas fora de um pedido HTTP — o motor de automações a mover negócios (cron/gatilhos) — emitem explicitamente.
- Sem mudanças de schema nem migrações.

**Frontend**
- `socket.io-client`, ligação criada ao iniciar sessão e fechada ao terminar (no `AuthContext`), a usar `VITE_API_URL` e o token de acesso; reconexão automática com o token **atual** (o de acesso expira em 15 min).
- Um mapa `resource → queryKeys` invalida as queries certas (*debounce* ~300 ms para juntar rajadas). **Escolha deliberada de âmbito:** só se invalidam consultas **sem estado local de edição**: Kanban/funis, tarefas, leads (lista), dashboard, timeline, email, caixa de entrada. **Não** se invalidam as fichas de empresa/contacto: os seus formulários copiam os dados da query para estado local, e uma atualização a meio da escrita apagava o que a pessoa estava a editar.
- **Kanban:** não reconstruir as colunas enquanto se está a arrastar um cartão (um evento a meio do arrasto desfazia o gesto).

## 3. Segurança e riscos

| Risco | Mitigação |
|---|---|
| Ligações WebSocket sem autenticação | Handshake exige token válido **e** utilizador ativo na BD; teste e2e |
| Utilizador desativado continuar a receber eventos | Verificado no handshake; as ligações já abertas de um utilizador desativado são fechadas ao desativá-lo |
| Origem pública a ligar-se ao socket | Mesma regra de CORS da API; teste e2e |
| Fuga de dados nos eventos | Payload fixo `{ resource, action }`; teste e2e que falha se tiver outras chaves |
| Tempestade de pedidos (evento → refetch → …) | Cliente com *debounce*; o refetch é de leitura e não emite eventos |
| Dependências novas com vulnerabilidades | Auditoria no CI (já bloqueia altas/críticas) |
| Perder o que se está a editar | Não invalidar fichas com estado local; Kanban não reconstrói a meio de um arrasto |
| O interceptor emitir para um pedido que falhou | Só emite depois de sucesso (`tap` no fluxo de resposta); teste e2e com um pedido recusado (403) |

## 4. Validação
- **E2E** (socket.io-client contra a app real em `listen(0)`): sem token → recusado; token adulterado → recusado; utilizador desativado → recusado; origem pública → recusada; ligado + criar negócio por HTTP → recebe `{resource:"deals",action:"POST"}` (e só essas chaves); pedido recusado (403) **não** emite; `/auth/*` não emite; desativar um utilizador ligado fecha-lhe a ligação.
- **Browser:** duas sessões em simultâneo (dois utilizadores de teste): uma move um cartão/cria uma tarefa, a outra vê a alteração **sem recarregar**.
- Builds, testes existentes e auditoria inalterados.

## 5. Fora de âmbito
Notificações push/sonoras, presença ("quem está a ver este negócio"), edição colaborativa/resolução de conflitos, atualização em tempo real das fichas de empresa/contacto, escalar para várias instâncias do backend (exigiria um adaptador Redis; hoje há uma só).

## 6. Registo de execução

- [x] Backend (gateway, serviço, interceptor, emissão nas automações)
- [x] Testes e2e
- [x] Frontend (ligação, invalidação, Kanban)
- [x] Validação no browser (uma sessão + a API; duas pessoas em simultâneo não testado)
- [ ] PR
