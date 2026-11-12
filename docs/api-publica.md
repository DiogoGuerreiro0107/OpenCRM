# API pública do OpenCRM (`/api/v1`)

API para sistemas externos (loja online, formulários do site, n8n, programas de faturação) falarem com o CRM. É **separada** da API que a interface usa: outras credenciais, outras rotas, outras garantias. Desenho e decisões: [plano-e0-api-publica.md](plano-e0-api-publica.md) (pacote E0c).

> **Estado:** primeira versão, só com o enquadramento e três recursos (`companies`, `contacts`, `leads`). Cada módulo novo acrescenta as suas rotas aqui. Os webhooks de saída estão descritos abaixo; a especificação OpenAPI gerada chega no pacote E0e.

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

## Webhooks (o CRM avisa o teu sistema)

Em vez de perguntares à API «há novidades?», o CRM chama um endereço teu quando algo acontece. Um Administrador cria a subscrição em **Configurações > Webhooks** (nome, URL de destino, eventos) e recebe um **segredo de assinatura** (`whsec_…`), mostrado **uma única vez**.

### O que recebes
Um `POST` com `Content-Type: application/json` e este envelope:

```json
{
  "id": "0b1f7c2e-5a0e-4f7e-9a53-2f1c8d0a7e11",
  "type": "lead.created",
  "version": 1,
  "occurred_at": "2026-11-12T10:00:00.000Z",
  "data": { "lead_id": "…", "name": "Maria Silva", "company_name": "Exemplo Lda", "email": "maria@exemplo.pt", "phone": "912345678", "source": "API: Formulário do site" }
}
```

Cabeçalhos: `X-OpenCRM-Event` (o tipo), `X-OpenCRM-Delivery` (id desta entrega), `X-OpenCRM-Signature` e `User-Agent: OpenCRM-Webhooks/1`.

| Evento | Quando | `data` |
|---|---|---|
| `lead.created` | lead criado (interface ou API) | `lead_id`, `name`, `company_name`, `email`, `phone`, `source` |
| `deal.created` | negócio criado | `deal_id`, `title`, `value`, `pipeline_id`, `stage_id`, `stage_name` |
| `deal.stage_changed` | negócio mudou de fase | `deal_id`, `title`, `pipeline_id`, `from_stage_id`, `from_stage_name`, `to_stage_id`, `to_stage_name`, `to_stage_type` |
| `deal.proposal_sent` | negócio entrou em «Proposta enviada» | `deal_id`, `title`, `pipeline_id`, `stage_id` |
| `automation.deal_moved` | uma automação moveu um negócio | `deal_id`, `rule_id`, `rule_name`, `to_stage_id`, `to_pipeline_id` |
| `automation.triggered` (ou o nome que deres na regra) | uma automação disparou um webhook | `deal_id`, `rule_id`, `rule_name` |
| `webhook.test` | botão «Enviar teste» | `message`, `subscription_name` |

Uma subscrição escolhe uma lista de eventos ou **todos** (`*`), o que inclui os que vierem a existir. Se uma regra de automação usar um nome de evento próprio fora do formato `recurso.acao` (minúsculas, com ponto), só as subscrições com `*` o recebem.

### Confirmar que o aviso vem do CRM (assinatura)
`X-OpenCRM-Signature: t=<unix>,v1=<hex>`, em que `v1` é o HMAC-SHA256, com o teu segredo, do texto `"<t>.<corpo exatamente como chegou>"`. Verifica **sempre** e recusa carimbos com mais de 5 minutos (evita que um pedido capturado seja repetido mais tarde):

```js
const crypto = require("crypto");

function vemDoCrm(segredo, corpoEmTexto, cabecalho) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(cabecalho ?? "");
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const esperado = crypto.createHmac("sha256", segredo).update(`${m[1]}.${corpoEmTexto}`).digest();
  const recebido = Buffer.from(m[2], "hex");
  return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
}
```

Usa o corpo **em bruto** (antes de o converteres de JSON): reserializar muda os bytes e a assinatura deixa de bater.

### Entrega, repetição e duplicados
- Responde **`2xx` em menos de 10 segundos**. Faz o trabalho pesado depois de responderes. Qualquer outra resposta (incluindo redirecionamentos, que **não são seguidos**) conta como falha.
- Em caso de falha o CRM volta a tentar ao fim de cerca de **1 min, 5 min, 30 min, 2 h e 6 h** (6 tentativas no total); depois a entrega fica **falhada** e um Administrador pode **reenviá-la** na página.
- A garantia é **pelo menos uma vez**: podes receber o mesmo evento mais de uma vez (repetições, reenvios). **Deduplica pelo `id` do envelope**, que é igual em todas as repetições. A ordem entre eventos não é garantida: usa `occurred_at`.
- Um destino com **20 falhas seguidas** é desativado automaticamente (fica dito na página e na auditoria); reativa-se à mão depois de corrigido.
- Se o backend do CRM for abaixo no instante exato entre gravar a alteração e registar o evento, esse evento perde-se. É raro, mas para dados críticos complementa os webhooks com uma sincronização periódica por `updated_since`.

### Variável antiga `N8N_WEBHOOK_URL`
Continua a funcionar como antes (um só URL, **sem assinatura nem repetição**, formato `{ event, payload, triggeredAt }`). É um modo **legado**: o recomendado é criar um webhook para o n8n na página e retirar a variável.

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
