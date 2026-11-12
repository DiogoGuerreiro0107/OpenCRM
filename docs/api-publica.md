# API pública do OpenCRM (`/api/v1`)

API para sistemas externos (loja online, formulários do site, n8n, programas de faturação) falarem com o CRM. É **separada** da API que a interface usa: outras credenciais, outras rotas, outras garantias. Desenho e decisões: [plano-e0-api-publica.md](plano-e0-api-publica.md) (pacote E0c).

> **Estado:** primeira versão, só com o enquadramento e três recursos (`companies`, `contacts`, `leads`). Cada módulo novo acrescenta as suas rotas aqui. A especificação OpenAPI gerada e os webhooks de saída chegam nos pacotes E0d/E0e.

## Autenticação

Cada integração tem a sua **chave de API**, criada por um Administrador em **Configurações > Chaves de API**.

```bash
curl -H "Authorization: Bearer ocrm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
     http://IP-DO-CRM:3000/api/v1/ping
```

- A chave tem o formato `ocrm_` + 43 caracteres e **só se vê uma vez**, ao criar. O CRM guarda apenas um hash; se a perderes, revoga-a e cria outra.
- **Âmbitos:** cada chave só pode fazer o que lhe deram (`companies:read`, `contacts:read`, `leads:write`). Sem o âmbito → `403`.
- **Duas portas separadas:** a `/api/v1` aceita **só** chaves de API (nunca o login de uma pessoa), e a API da interface aceita **só** login (nunca chaves).
- Chave em falta, inválida, **revogada ou expirada** dão o **mesmo** `401` (não se revela qual).
- **Limite:** por omissão 120 pedidos por minuto por chave (configurável). Acima disso, `429` com `Retry-After` (segundos).
- ⚠️ **HTTPS:** se o CRM for usado por `http://`, a chave viaja sem cifra e quem estiver na rede pode lê-la. Usa estas chaves apenas em redes de confiança até haver HTTPS.

## Convenções

- JSON em UTF-8. Campos e parâmetros em **snake_case**. Datas em ISO 8601 (UTC). Identificadores são texto (UUID).
- Respostas de sucesso: `{ "data": ... }`; listas: `{ "data": [...], "next_cursor": "..." | null }`.
- **Erros** (sempre neste formato, com `code` estável):

```json
{ "error": { "code": "invalid_request", "message": "Pedido inválido", "details": ["email deve ser um email"] } }
```

| `code` | HTTP | Quando |
|---|---|---|
| `invalid_request` | 400 | corpo/parâmetros inválidos, `Idempotency-Key` em falta ou inválido |
| `unauthorized` | 401 | chave em falta, inválida, revogada ou expirada |
| `insufficient_scope` | 403 | a chave não tem o âmbito necessário |
| `not_found` | 404 | recurso inexistente (ou módulo desligado) |
| `conflict` | 409 | pedido igual ainda em curso com o mesmo `Idempotency-Key` |
| `idempotency_key_reuse` | 422 | mesmo `Idempotency-Key` com um pedido diferente |
| `rate_limited` | 429 | limite de pedidos da chave excedido |
| `internal_error` | 5xx | erro do servidor (sem detalhes) |

### Paginação e sincronização

As listas ordenam-se por **data de alteração crescente** (desempate por `id`), para sincronizar sem repetir nem saltar:

- `limit` (1–100, por omissão 50);
- `cursor`: o `next_cursor` da página anterior (opaco; `null` = acabou);
- `updated_since` (ISO 8601): só o que mudou desde essa data.

Sincronização incremental típica: guarda a data do início da última sincronização completa e pede `?updated_since=<essa data>`, percorrendo as páginas com `cursor`.

### Idempotência (`Idempotency-Key`)

Todo o `POST` aceita o cabeçalho `Idempotency-Key` (8 a 128 caracteres visíveis, sem espaços; usa um UUID), e **é obrigatório** em `POST /leads`:

- repetir o **mesmo pedido** (mesmo corpo) devolve a **mesma resposta**, com o cabeçalho `Idempotent-Replayed: true`, e **não cria nada de novo** — é seguro repetir depois de um *timeout*;
- o mesmo `Idempotency-Key` com um corpo diferente dá `422`;
- um pedido igual ainda em curso dá `409` (tenta daqui a pouco);
- só as respostas **bem-sucedidas** ficam guardadas: se o pedido falhou, corrige-o e repete com a mesma chave;
- os registos duram **24 horas**; o escopo é a chave de API (duas integrações podem usar o mesmo texto).

## Rotas

### `GET /api/v1/ping`
Qualquer chave válida. Confirma que a chave funciona e mostra os âmbitos.

```json
{ "data": { "api_version": "v1", "server_time": "2026-11-11T17:00:00.000Z",
            "api_key": { "id": "…", "name": "Formulário do site", "scopes": ["leads:write"] } } }
```

### `GET /api/v1/companies` · `GET /api/v1/companies/{id}` — âmbito `companies:read`
Campos: `id`, `name`, `legal_name`, `tax_id`, `website`, `phone`, `email`, `address`, `postal_code`, `city`, `country`, `status` (`ATIVO`, `POTENCIAL`, `INATIVO`, `PERDIDO`), `source`, `created_at`, `updated_at`.

### `GET /api/v1/contacts` · `GET /api/v1/contacts/{id}` — âmbito `contacts:read`
Campos: `id`, `name`, `email`, `phone`, `mobile_phone`, `job_title`, `department`, `preferred_channel`, `is_decision_maker`, `marketing_consent`, `company_id`, `created_at`, `updated_at`.

### `POST /api/v1/leads` — âmbito `leads:write`
Exige `Idempotency-Key`. Só existe se o módulo de **Leads** estiver ligado (senão `404`).

```bash
curl -X POST http://IP-DO-CRM:3000/api/v1/leads \
  -H "Authorization: Bearer ocrm_…" \
  -H "Idempotency-Key: 6f1c2f0e-3a8e-4f43-9c0b-1d2a7a9c8e11" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Maria Silva", "email": "maria@exemplo.pt", "phone": "912345678", "company_name": "Exemplo Lda", "interest": "IMPRESSAO", "notes": "Pediu orçamento" }'
```

Corpo: `name` (obrigatório), `company_name`, `phone`, `email`, `source` (por omissão «API: <nome da chave>»), `interest`, `notes`. Outros campos são ignorados: uma integração **não escolhe** o estado nem o responsável (o lead entra como `NOVO`). Resposta `201` com o lead (`id`, `name`, `company_name`, `phone`, `email`, `source`, `interest`, `status`, `notes`, `created_at`, `updated_at`).

Efeitos (iguais a criar um lead na interface): fica criada a tarefa «Contactar lead», atribuída a **quem criou a chave**; é disparado o webhook `lead.created` para o n8n (se configurado); a lista de leads atualiza-se nos browsers abertos.

## Política de versões

- Esta é a **v1**. **Dentro da v1 só se acrescenta**: rotas novas, campos novos nas respostas, parâmetros opcionais novos. Quem consome deve **ignorar campos que não conhece**.
- Valores novos em campos de enumeração (ex.: um novo `status`) também contam como acrescento: trata valores desconhecidos com cuidado.
- **Remover** ou **mudar o sentido** de algo exige uma **v2** (`/api/v2`), mantendo a v1 durante um período de descontinuação anunciado, com os cabeçalhos `Deprecation` e `Sunset` nas respostas da v1.
- Os **códigos de erro** (`error.code`) fazem parte do contrato; as **mensagens** são para pessoas e podem mudar.
- Um teste automático garante que toda a rota da `/api/v1` exige chave de API e declara os âmbitos, e que nenhuma delas aceita o login de uma pessoa.

## Boas práticas para quem integra

- Uma chave **por integração** e com o **mínimo de âmbitos**; dá-lhe um nome que diga de onde vem.
- Guarda a chave num sítio seguro (variável de ambiente, gestor de segredos); nunca em código ou em repositórios.
- Em erros `5xx`, `429` e *timeouts*, repete com **recuo exponencial** e o **mesmo** `Idempotency-Key`; em `4xx` (exceto `409`/`429`) corrige o pedido, não repitas às cegas.
- Respeita `Retry-After` no `429`.
