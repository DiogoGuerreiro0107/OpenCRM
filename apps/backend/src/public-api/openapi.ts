import { BusinessArea, CompanySource, CompanyStatus, LeadStatus, PreferredChannel } from "@prisma/client";
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
  tags: [{ name: "Geral" }, { name: "Empresas" }, { name: "Contactos" }, { name: "Leads" }],
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
        required: ["id", "name", "status", "external_id", "created_at", "updated_at"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          company_name: nullable("string"),
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
      LeadCreate: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 200 },
          company_name: { type: "string", maxLength: 200 },
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
