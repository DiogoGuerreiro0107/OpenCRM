import Ajv2020, { ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { OPENAPI_SPEC } from "../src/public-api/openapi";

/**
 * Valida respostas REAIS contra a especificação OpenAPI (pacote E0e). Usado nos e2e: um campo que um mapeador
 * passe a devolver sem estar documentado faz falhar o teste (`additionalProperties: false`).
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(OPENAPI_SPEC as unknown as object, "spec");

const cache = new Map<string, ValidateFunction>();

/** Troca as referências locais da especificação para apontarem para o documento registado como "spec". */
function rebase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rebase);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, k === "$ref" && typeof v === "string" && v.startsWith("#/") ? `spec${v}` : rebase(v)]),
    );
  }
  return value;
}

function validatorFor(method: string, specPath: string, status: number): ValidateFunction {
  const key = `${method} ${specPath} ${status}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const operation = (OPENAPI_SPEC.paths as Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: unknown }> }> }>>)[specPath]?.[
    method.toLowerCase()
  ];
  if (!operation) throw new Error(`A especificação não tem a operação ${method} ${specPath}`);
  const response = operation.responses[String(status)];
  if (!response) throw new Error(`A especificação não documenta o estado ${status} em ${method} ${specPath}`);
  const schema = response.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`Sem esquema JSON para ${status} em ${method} ${specPath}`);

  const validate = ajv.compile(rebase(schema) as object);
  cache.set(key, validate);
  return validate;
}

/** Lança (com os erros do ajv) se a resposta não cumprir a especificação. */
export function expectConforms(res: { status: number; body: unknown }, method: string, specPath: string) {
  const validate = validatorFor(method, specPath, res.status);
  if (!validate(res.body)) {
    throw new Error(
      `Resposta ${res.status} de ${method} ${specPath} não cumpre a especificação OpenAPI:\n` +
        `${JSON.stringify(validate.errors, null, 2)}\nCorpo: ${JSON.stringify(res.body).slice(0, 500)}`,
    );
  }
}
