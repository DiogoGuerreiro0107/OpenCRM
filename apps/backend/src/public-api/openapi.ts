import { BusinessArea, CompanySource, CompanyStatus, LeadKind, LeadStatus, PreferredChannel, ProductUnit, SalesOrderStatus } from "@prisma/client";
import { MAX_API_ORDER_LINES } from "./dto/v1-orders.dto";
import { API_ERROR_CODES } from "./v1-error.filter";
import { API_SCOPES } from "./scopes";

/**
 * Especificação OpenAPI 3.1 da API pública v1 (pacote E0e, docs/plano-e0-api-publica.md).
 *
 * ESCRITA À MÃO de propósito: as respostas da v1 são construídas por mapeadores (mappers.ts) e esta especificação
 * É o contrato que a política de versões protege. Para não divergir do código há testes que verificam:
 *  - que as rotas, os métodos e os âmbitos daqui coincidem com os controllers (public-api-openapi.spec.ts);
 *  - que as respostas REAIS dos testes e2e cumprem os esquemas daqui (`additionalProperties: false`).
 * Dentro da v1 só se acrescenta: campos novos, rotas novas, valores novos em enumerações.
 */

// ---------- Peças reutilizáveis ----------

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });
const dateTime = { type: "string", format: "date-time" };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ "application/json": { schema } });

const errorResponse = (description: string) => ({ description, content: json(ref("Error")) });

/** Respostas de erro comuns a todas as rotas autenticadas. */
const COMMON_ERRORS = {
  "401": errorResponse("Chave de API em falta, inválida, revogada ou expirada (`unauthorized`)."),
  "403": errorResponse("A chave não tem o âmbito necessário (`insufficient_scope`)."),
  "429": {
    description: "Limite de pedidos da chave excedido (`rate_limited`).",
    headers: { "Retry-After": { description: "Segundos até poder repetir.", schema: { type: "integer" } } },
    content: json(ref("Error")),
  },
};

const listParameters = [
  { name: "limit", in: "query", required: false, description: "1 a 100 (por omissão 50).", schema: { type: "integer", minimum: 1, maximum: 100 } },
  { name: "cursor", in: "query", required: false, description: "O `next_cursor` da página anterior (opaco).", schema: { type: "string" } },
  {
    name: "updated_since",
    in: "query",
    required: false,
    description: "Só registos alterados desde esta data (ISO 8601). Ordem: data de alteração crescente.",
    schema: { type: "string", format: "date-time" },
  },
];

const idParameter = { name: "id", in: "path", required: true, schema: { type: "string" } };

const listOf = (item: string) => ({
  type: "object",
  additionalProperties: false,
  required: ["data", "next_cursor"],
  properties: { data: { type: "array", items: ref(item) }, next_cursor: nullable("string") },
});

const idempotencyHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description: "8 a 128 caracteres visíveis (usa um UUID). Repetir o mesmo pedido devolve a mesma resposta.",
  schema: { type: "string", minLength: 8, maxLength: 128 },
};

const single = (item: string) => ({ type: "object", additionalProperties: false, required: ["data"], properties: { data: ref(item) } });

// ---------- Especificação ----------

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "OpenCRM — API pública",
    version: "1.0.0",
    description:
      "API para integrações (lojas online, formulários, n8n, faturação). Autenticação por chave de API " +
      "(`Authorization: Bearer ocrm_…`), criada em Configurações > Chaves de API. Contrato, idempotência, webhooks e " +
      "política de versões: docs/api-publica.md.",
  },
  servers: [{ url: "/", description: "O endereço do teu CRM (ex.: http://192.168.1.10:3000)" }],
  security: [{ apiKey: [] }],
  tags: [{ name: "Geral" }, { name: "Empresas" }, { name: "Contactos" }, { name: "Leads" }, { name: "Produtos" }, { name: "Encomendas" }],
  paths: {
    "/api/v1/ping": {
      get: {
        operationId: "ping",
        tags: ["Geral"],
        summary: "Confirma que a chave funciona e mostra os seus âmbitos",
        security: [{ apiKey: [] }],
        responses: { "200": { description: "Chave válida.", content: json(ref("PingResponse")) }, ...COMMON_ERRORS },
      },
    },
    "/api/v1/openapi.json": {
      get: {
        operationId: "getOpenApi",
        tags: ["Geral"],
        summary: "Esta especificação (importável no Postman/Insomnia)",
        security: [{ apiKey: [] }],
        responses: { "200": { description: "Especificação OpenAPI 3.1.", content: json({ type: "object" }) }, ...COMMON_ERRORS },
      },
    },
    "/api/v1/companies": {
      get: {
        operationId: "listCompanies",
        tags: ["Empresas"],
        summary: "Lista empresas (sincronização por cursor e updated_since)",
        security: [{ apiKey: ["companies:read"] }],
        parameters: listParameters,
        responses: {
          "200": { description: "Uma página.", content: json(listOf("Company")) },
          "400": errorResponse("Parâmetros inválidos (`invalid_request`)."),
          ...COMMON_ERRORS,
        },
      },
    },
    "/api/v1/companies/{id}": {
      get: {
        operationId: "getCompany",
        tags: ["Empresas"],
        summary: "Uma empresa",
        security: [{ apiKey: ["companies:read"] }],
        parameters: [idParameter],
        responses: {
          "200": { description: "A empresa.", content: json(single("Company")) },
          "404": errorResponse("Não existe (`not_found`)."),
          ...COMMON_ERRORS,
        },
      },
    },
    "/api/v1/contacts": {
      get: {
        operationId: "listContacts",
        tags: ["Contactos"],
        summary: "Lista contactos (sincronização por cursor e updated_since)",
        security: [{ apiKey: ["contacts:read"] }],
        parameters: listParameters,
        responses: {
          "200": { description: "Uma página.", content: json(listOf("Contact")) },
          "400": errorResponse("Parâmetros inválidos (`invalid_request`)."),
          ...COMMON_ERRORS,
        },
      },
    },
    "/api/v1/contacts/{id}": {
      get: {
        operationId: "getContact",
        tags: ["Contactos"],
        summary: "Um contacto",
        security: [{ apiKey: ["contacts:read"] }],
        parameters: [idParameter],
        responses: {
          "200": { description: "O contacto.", content: json(single("Contact")) },
          "404": errorResponse("Não existe (`not_found`)."),
          ...COMMON_ERRORS,
        },
      },
    },
    "/api/v1/leads": {
      post: {
        operationId: "createLead",
        tags: ["Leads"],
        summary: "Cria um lead (ex.: formulário do site). Só existe com o módulo de Leads ligado.",
        description:
          "Faz o mesmo que criar um lead na interface: tarefa «Contactar lead» para quem criou a chave, webhook " +
          "`lead.created`. O lead entra como `NOVO`; campos desconhecidos são ignorados.",
        security: [{ apiKey: ["leads:write"] }],
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            description: "8 a 128 caracteres visíveis (usa um UUID). Repetir o mesmo pedido devolve a mesma resposta.",
            schema: { type: "string", minLength: 8, maxLength: 128 },
          },
        ],
        requestBody: { required: true, content: json(ref("LeadCreate")) },
        responses: {
          "201": {
            description: "Criado (ou repetição de um pedido já feito, com o cabeçalho `Idempotent-Replayed: true`).",
            headers: { "Idempotent-Replayed": { description: "`true` numa repetição.", schema: { type: "string" } } },
            content: json(single("Lead")),
          },
          "400": errorResponse("Corpo inválido ou `Idempotency-Key` em falta/inválido (`invalid_request`)."),
          "404": errorResponse("Módulo de Leads desligado (`not_found`)."),
          "409": errorResponse(
            "Pedido igual ainda em curso, ou `external_id` já usado por esta chave (`conflict`; o id existente vem em `details.existing_id`).",
          ),
          "422": errorResponse("`Idempotency-Key` já usado com um pedido diferente (`idempotency_key_reuse`)."),
          ...COMMON_ERRORS,
        },
      },
    },
    "/api/v1/products": {
      get: {
        operationId: "listProducts",
        tags: ["Produtos"],
        summary: "Lista produtos (sincronização por cursor e updated_since). Só com o módulo de Produtos ligado.",
        description:
          "O stock muda sem mudar a data de alteração do produto: para o stock atual lê o produto (ou a lista completa); " +
          "a sincronização por data é para o catálogo. Nunca inclui custos nem fornecedores.",
        security: [{ apiKey: ["products:read"] }],
        parameters: [
          ...listParameters,
          { name: "sku", in: "query", required: false, description: "Referência exata (sem distinguir maiúsculas).", schema: { type: "string", maxLength: 64 } },
        ],
        responses: {
          "200": { description: "Uma página.", content: json(listOf("Product")) },
          "400": errorResponse("Parâmetros inválidos (`invalid_request`)."),
          "404": errorResponse("Módulo de Produtos desligado (`not_found`)."),
          ...COMMON_ERRORS,
        },
      },
    },
    "/api/v1/products/{id}": {
      get: {
        operationId: "getProduct",
        tags: ["Produtos"],
        summary: "Um produto (com o stock atual)",
        security: [{ apiKey: ["products:read"] }],
        parameters: [idParameter],
        responses: {
          "200": { description: "O produto.", content: json(single("Product")) },
          "404": errorResponse("Não existe, ou módulo de Produtos desligado (`not_found`)."),
          ...COMMON_ERRORS,
        },
      },
    },
    "/api/v1/orders": {
      get: {
        operationId: "listOrders",
        tags: ["Encomendas"],
        summary: "Lista encomendas (sincronização por cursor e updated_since). Só com o módulo de Encomendas ligado.",
        security: [{ apiKey: ["orders:read"] }],
        parameters: [
          ...listParameters,
          {
            name: "external_id",
            in: "query",
            required: false,
            description: "Só a encomenda a que ESTA chave deu este id externo.",
            schema: { type: "string", maxLength: 100 },
          },
        ],
        responses: {
          "200": { description: "Uma página.", content: json(listOf("Order")) },
          "400": errorResponse("Parâmetros inválidos (`invalid_request`)."),
          "404": errorResponse("Módulo de Encomendas desligado (`not_found`)."),
          ...COMMON_ERRORS,
        },
      },
      post: {
        operationId: "createOrder",
        tags: ["Encomendas"],
        summary: "Cria uma encomenda (ex.: loja online), com o cliente encontrado pelo NIF/email ou criado",
        description:
          "Faz o mesmo que criar a encomenda na interface (timeline, webhooks `order.created` e, com `confirm`, " +
          "`order.status_changed`). Com `confirm: true` nasce confirmada e reserva stock; senão fica em rascunho. " +
          "Tudo ou nada: se uma linha falhar, nada fica criado. Campos desconhecidos são ignorados.",
        security: [{ apiKey: ["orders:write"] }],
        parameters: [idempotencyHeader],
        requestBody: { required: true, content: json(ref("OrderCreate")) },
        responses: {
          "201": {
            description: "Criada (ou repetição de um pedido já feito, com o cabeçalho `Idempotent-Replayed: true`).",
            headers: { "Idempotent-Replayed": { description: "`true` numa repetição.", schema: { type: "string" } } },
            content: json(single("Order")),
          },
          "400": errorResponse("Corpo inválido ou `Idempotency-Key` em falta/inválido (`invalid_request`)."),
          "404": errorResponse("Módulo de Encomendas desligado (`not_found`)."),
          "409": errorResponse(
            "Pedido igual ainda em curso, ou `external_id` já usado por esta chave (`conflict`; o id existente vem em `details.existing_id`).",
          ),
          "422": errorResponse(
            "`Idempotency-Key` já usado com um pedido diferente (`idempotency_key_reuse`), ou linha/cliente que não se pode cumprir " +
              "(`unprocessable`; `details.line_index` e `details.reason`: `unknown_sku`, `inactive_product`, `missing_price`; ou `details.field: \"customer\"`).",
          ),
          ...COMMON_ERRORS,
        },
      },
    },
    "/api/v1/orders/{id}": {
      get: {
        operationId: "getOrder",
        tags: ["Encomendas"],
        summary: "Uma encomenda (estado, linhas, expedições com o link de seguimento)",
        security: [{ apiKey: ["orders:read"] }],
        parameters: [idParameter],
        responses: {
          "200": { description: "A encomenda.", content: json(single("Order")) },
          "404": errorResponse("Não existe, ou módulo de Encomendas desligado (`not_found`)."),
          ...COMMON_ERRORS,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "ocrm_…",
        description: "Chave de API. Os âmbitos exigidos por cada operação estão no seu `security`.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        additionalProperties: false,
        required: ["error"],
        properties: {
          error: {
            type: "object",
            additionalProperties: false,
            required: ["code", "message"],
            properties: {
              code: { type: "string", enum: [...API_ERROR_CODES], description: "Estável (faz parte do contrato)." },
              message: { type: "string", description: "Para pessoas; pode mudar." },
              details: { description: "Pormenores (ex.: lista de erros de validação, `existing_id`)." },
            },
          },
        },
      },
      PingResponse: {
        type: "object",
        additionalProperties: false,
        required: ["data"],
        properties: {
          data: {
            type: "object",
            additionalProperties: false,
            required: ["api_version", "server_time", "api_key"],
            properties: {
              api_version: { type: "string", const: "v1" },
              server_time: dateTime,
              api_key: {
                type: "object",
                additionalProperties: false,
                required: ["id", "name", "scopes"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  scopes: { type: "array", items: { type: "string", enum: Object.keys(API_SCOPES) } },
                },
              },
            },
          },
        },
      },
      Company: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "status", "created_at", "updated_at"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          legal_name: nullable("string"),
          tax_id: nullable("string"),
          website: nullable("string"),
          phone: nullable("string"),
          email: nullable("string"),
          address: nullable("string"),
          postal_code: nullable("string"),
          city: nullable("string"),
          country: nullable("string"),
          status: { type: "string", enum: Object.values(CompanyStatus) },
          source: { enum: [...Object.values(CompanySource), null] },
          created_at: dateTime,
          updated_at: dateTime,
        },
      },
      Contact: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "is_decision_maker", "marketing_consent", "created_at", "updated_at"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          email: nullable("string"),
          phone: nullable("string"),
          mobile_phone: nullable("string"),
          job_title: nullable("string"),
          department: nullable("string"),
          preferred_channel: { enum: [...Object.values(PreferredChannel), null] },
          is_decision_maker: { type: "boolean" },
          marketing_consent: { type: "boolean" },
          company_id: nullable("string"),
          created_at: dateTime,
          updated_at: dateTime,
        },
      },
      Lead: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "name", "status", "external_id", "created_at", "updated_at"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: Object.values(LeadKind), description: "COMPANY (lead de empresa) ou PERSON (lead de pessoa)." },
          name: { type: "string" },
          company_name: nullable("string"),
          tax_id: nullable("string", { description: "NIF (leads de empresa)." }),
          phone: nullable("string"),
          email: nullable("string"),
          source: nullable("string"),
          interest: { enum: [...Object.values(BusinessArea), null] },
          status: { type: "string", enum: Object.values(LeadStatus) },
          notes: nullable("string"),
          external_id: nullable("string", { description: "O id externo enviado por esta integração, se houver." }),
          created_at: dateTime,
          updated_at: dateTime,
        },
      },
      Product: {
        type: "object",
        additionalProperties: false,
        required: ["id", "sku", "name", "unit", "sale_price", "vat_rate", "active", "tracks_stock", "category", "stock_on_hand", "reserved", "available", "created_at", "updated_at"],
        properties: {
          id: { type: "string" },
          sku: { type: "string" },
          name: { type: "string" },
          description: nullable("string"),
          barcode: nullable("string"),
          unit: { type: "string", enum: Object.values(ProductUnit) },
          sale_price: nullable("number", { description: "Preço de venda SEM IVA (null = sem preço no catálogo)." }),
          vat_rate: { type: "number", description: "Taxa de IVA (%)." },
          active: { type: "boolean", description: "Um produto desativado não se pode encomendar." },
          tracks_stock: { type: "boolean" },
          category: {
            oneOf: [
              { type: "null" },
              { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string" } } },
            ],
          },
          stock_on_hand: nullable("number", { description: "null sem o módulo de Stock ou num produto que não controla stock." }),
          reserved: nullable("number", { description: "Reservado para encomendas confirmadas." }),
          available: nullable("number", { description: "stock_on_hand − reserved (pode ser negativo)." }),
          created_at: dateTime,
          updated_at: dateTime,
        },
      },
      Order: {
        type: "object",
        additionalProperties: false,
        required: [
          "id", "code", "status", "partially_shipped", "customer", "customer_reference", "delivery_address", "subtotal", "vat_total",
          "total", "external_id", "lines", "shipments", "confirmed_at", "shipped_at", "delivered_at", "cancelled_at", "cancel_reason",
          "created_at", "updated_at",
        ],
        properties: {
          id: { type: "string" },
          code: { type: "string", description: "Número interno («EN-0001»), sem valor fiscal." },
          status: { type: "string", enum: Object.values(SalesOrderStatus) },
          partially_shipped: { type: "boolean", description: "Confirmada com parte já enviada." },
          customer: {
            type: "object",
            additionalProperties: false,
            required: ["company_id", "contact_id"],
            properties: { company_id: nullable("string"), contact_id: nullable("string") },
          },
          customer_reference: nullable("string"),
          delivery_address: nullable("string"),
          subtotal: { type: "number", description: "Sem IVA." },
          vat_total: { type: "number" },
          total: { type: "number", description: "Com IVA (indicativo; sem valor fiscal)." },
          external_id: nullable("string", { description: "O id que ESTA chave deu à encomenda ao criá-la, se houver." }),
          lines: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "product_id", "sku", "description", "quantity", "unit_price", "discount_pct", "vat_rate", "line_total", "shipped_quantity"],
              properties: {
                id: { type: "string" },
                product_id: nullable("string"),
                sku: nullable("string"),
                description: { type: "string" },
                quantity: { type: "number" },
                unit_price: { type: "number", description: "Sem IVA." },
                discount_pct: { type: "number" },
                vat_rate: { type: "number" },
                line_total: { type: "number", description: "Sem IVA, já com o desconto." },
                shipped_quantity: { type: "number" },
              },
            },
          },
          shipments: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "shipped_at", "carrier", "tracking_code", "tracking_url", "packages", "weight_kg", "lines"],
              properties: {
                id: { type: "string" },
                shipped_at: dateTime,
                carrier: nullable("string"),
                tracking_code: nullable("string"),
                tracking_url: nullable("string", { description: "Link de seguimento da transportadora com o código." }),
                packages: nullable("integer"),
                weight_kg: nullable("number"),
                lines: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["order_line_id", "sku", "description", "quantity"],
                    properties: { order_line_id: { type: "string" }, sku: nullable("string"), description: { type: "string" }, quantity: { type: "number" } },
                  },
                },
              },
            },
          },
          confirmed_at: nullable("string", { format: "date-time" }),
          shipped_at: nullable("string", { format: "date-time" }),
          delivered_at: nullable("string", { format: "date-time" }),
          cancelled_at: nullable("string", { format: "date-time" }),
          cancel_reason: nullable("string"),
          created_at: dateTime,
          updated_at: dateTime,
        },
      },
      OrderCreate: {
        type: "object",
        required: ["customer", "lines"],
        properties: {
          customer: {
            type: "object",
            description:
              "Pelo menos um de tax_id, email, company_name ou name. Empresa: a do mesmo NIF; senão, com company_name, criada. " +
              "Contacto: o do mesmo email; senão, com name ou email, criado. Um contacto de outra empresa não entra na encomenda.",
            properties: {
              tax_id: { type: "string", maxLength: 20, description: "NIF («PT 123 456 789» = «123456789»)." },
              email: { type: "string", format: "email" },
              company_name: { type: "string", maxLength: 200 },
              name: { type: "string", maxLength: 200, description: "A pessoa (contacto)." },
              phone: { type: "string", maxLength: 50 },
            },
          },
          lines: {
            type: "array",
            minItems: 1,
            maxItems: MAX_API_ORDER_LINES,
            items: {
              type: "object",
              required: ["quantity"],
              description: "Por `sku` (produto ativo do catálogo) ou livre (`description`, `unit_price` e `vat_rate` obrigatórios; ex.: portes).",
              properties: {
                sku: { type: "string", maxLength: 64 },
                description: { type: "string", maxLength: 300, description: "Por omissão, o nome do produto." },
                quantity: { type: "number", exclusiveMinimum: 0, description: "Até duas casas decimais." },
                unit_price: { type: "number", minimum: 0, description: "SEM IVA. Por omissão, o preço do catálogo (com ele, o da loja: promoções)." },
                discount_pct: { type: "number", minimum: 0, maximum: 100 },
                vat_rate: { type: "number", minimum: 0, maximum: 100, description: "Por omissão, a do produto." },
              },
            },
          },
          customer_reference: { type: "string", maxLength: 100, description: "Por omissão, o external_id." },
          delivery_address: { type: "string", maxLength: 1000 },
          notes: { type: "string", maxLength: 5000, description: "Notas internas (ex.: o comentário do cliente)." },
          confirm: { type: "boolean", description: "true: nasce confirmada e reserva stock. Por omissão false (rascunho)." },
          external_id: {
            type: "string",
            minLength: 1,
            maxLength: 100,
            description: "Número da encomenda na loja. Repetido pela mesma chave → 409 com a encomenda existente.",
          },
        },
      },
      LeadCreate: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 200 },
          kind: { type: "string", enum: Object.values(LeadKind), description: "Sem valor: conforme o modo do módulo de leads (com nome de empresa → COMPANY)." },
          company_name: { type: "string", maxLength: 200 },
          tax_id: { type: "string", maxLength: 20, description: "NIF (leads de empresa)." },
          phone: { type: "string", maxLength: 50 },
          email: { type: "string", format: "email" },
          source: { type: "string", maxLength: 100, description: "Por omissão «API: <nome da chave>»." },
          interest: { type: "string", enum: Object.values(BusinessArea) },
          notes: { type: "string", maxLength: 5000 },
          external_id: {
            type: "string",
            minLength: 1,
            maxLength: 200,
            description: "Id no sistema de origem. Repetido pela mesma chave → 409 com o lead existente.",
          },
        },
      },
    },
  },
} as const;
