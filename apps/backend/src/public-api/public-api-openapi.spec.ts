import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import { RequestMethod } from "@nestjs/common";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { OPENAPI_SPEC } from "./openapi";
import { SCOPES_KEY } from "./scopes.decorator";
import { API_ERROR_CODES } from "./v1-error.filter";

/**
 * A especificação OpenAPI é escrita à mão (openapi.ts). Estes testes impedem que ela e o código divirjam:
 * rotas, métodos e âmbitos têm de coincidir nos dois sentidos. (A forma das respostas é verificada nos e2e.)
 */
const SRC = path.resolve(__dirname, "..");

function findControllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findControllerFiles(full);
    return entry.name.endsWith(".controller.ts") ? [full] : [];
  });
}

interface CodeRoute {
  key: string; // "get /api/v1/companies/{id}"
  scopes: string[] | undefined;
}

function codeRoutes(): CodeRoute[] {
  const routes: CodeRoute[] = [];
  for (const file of findControllerFiles(SRC)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== "function") continue;
      const base = Reflect.getMetadata("path", exported);
      if (typeof base !== "string" || !base.startsWith("api/v1")) continue;
      const proto = exported.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === "constructor" || typeof handler !== "function") continue;
        const method: RequestMethod | undefined = Reflect.getMetadata("method", handler);
        if (method === undefined) continue;
        const sub = String(Reflect.getMetadata("path", handler));
        const full = `/${base}/${sub}`.replace(/\/+/g, "/").replace(/\/$/, "").replace(/:(\w+)/g, "{$1}");
        routes.push({ key: `${RequestMethod[method].toLowerCase()} ${full}`, scopes: Reflect.getMetadata(SCOPES_KEY, handler) });
      }
    }
  }
  return routes;
}

type Operation = { operationId: string; security: Array<{ apiKey: readonly string[] }>; responses: Record<string, unknown> };

function specOperations(): Array<{ key: string; op: Operation }> {
  return Object.entries(OPENAPI_SPEC.paths).flatMap(([p, methods]) =>
    Object.entries(methods as unknown as Record<string, Operation>).map(([m, op]) => ({ key: `${m} ${p}`, op })),
  );
}

describe("especificação OpenAPI (openapi.ts)", () => {
  const code = codeRoutes();
  const spec = specOperations();

  it("é OpenAPI 3.1 e todos os esquemas são JSON Schema 2020-12 válidos", () => {
    expect(OPENAPI_SPEC.openapi).toBe("3.1.0");
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(OPENAPI_SPEC as unknown as object, "spec");
    for (const name of Object.keys(OPENAPI_SPEC.components.schemas)) {
      expect(() => ajv.compile({ $ref: `spec#/components/schemas/${name}` })).not.toThrow();
    }
  });

  it("descobre as rotas da v1 (o teste não passa por estar vazio)", () => {
    expect(code.length).toBeGreaterThanOrEqual(7);
  });

  it("toda a rota do código está na especificação, e vice-versa", () => {
    const inCode = new Set(code.map((r) => r.key));
    const inSpec = new Set(spec.map((o) => o.key));
    expect([...inCode].filter((k) => !inSpec.has(k)).sort()).toEqual([]);
    expect([...inSpec].filter((k) => !inCode.has(k)).sort()).toEqual([]);
  });

  it("os âmbitos de cada operação coincidem com os @Scopes() do código", () => {
    const scopesInCode = new Map(code.map((r) => [r.key, [...(r.scopes ?? [])].sort()]));
    for (const { key, op } of spec) {
      expect({ key, scopes: [...(op.security?.[0]?.apiKey ?? [])].sort() }).toEqual({ key, scopes: scopesInCode.get(key) });
    }
  });

  it("operationId únicos; todas as respostas de erro usam o esquema Error", () => {
    const ids = spec.map((o) => o.op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { key, op } of spec) {
      for (const [status, response] of Object.entries(op.responses)) {
        if (Number(status) < 400) continue;
        const schema = (response as { content?: Record<string, { schema: { $ref?: string } }> }).content?.["application/json"]?.schema;
        expect({ key, status, ref: schema?.$ref }).toEqual({ key, status, ref: "#/components/schemas/Error" });
      }
    }
  });

  it("os códigos de erro documentados são os do filtro de erros", () => {
    expect(OPENAPI_SPEC.components.schemas.Error.properties.error.properties.code.enum).toEqual([...API_ERROR_CODES]);
  });
});
