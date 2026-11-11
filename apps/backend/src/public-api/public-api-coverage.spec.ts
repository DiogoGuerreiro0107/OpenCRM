import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import { RequestMethod } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ApiKeyGuard } from "./api-key.guard";
import { IDEMPOTENT_KEY } from "./idempotency";
import { ALL_SCOPES } from "./scopes";
import { SCOPES_KEY } from "./scopes.decorator";

/**
 * Testes estruturais da API pública: as duas portas (JWT da interface e chave de API) nunca se misturam, e toda a
 * rota `/api/v1` declara os âmbitos de que precisa. Uma rota nova que não o faça falha o CI.
 */
const SRC = path.resolve(__dirname, "..");

function findControllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findControllerFiles(full);
    return /\.controllers?\.ts$/.test(entry.name) ? [full] : [];
  });
}

interface Route {
  label: string;
  controllerPath: string;
  method: RequestMethod;
  guards: unknown[];
  scopes: string[] | undefined;
  idempotent: unknown;
}

function collectRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of findControllerFiles(SRC)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== "function") continue;
      const controllerPath = Reflect.getMetadata("path", exported);
      if (controllerPath === undefined) continue;
      const classGuards: unknown[] = Reflect.getMetadata("__guards__", exported) ?? [];
      const proto = exported.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === "constructor" || typeof handler !== "function") continue;
        const method: RequestMethod | undefined = Reflect.getMetadata("method", handler);
        if (method === undefined) continue;
        const handlerGuards: unknown[] = Reflect.getMetadata("__guards__", handler) ?? [];
        routes.push({
          label: `${RequestMethod[method]} ${controllerPath}/${Reflect.getMetadata("path", handler)} (${exported.name}.${name})`,
          controllerPath: String(controllerPath),
          method,
          guards: [...classGuards, ...handlerGuards],
          scopes: Reflect.getMetadata(SCOPES_KEY, handler) ?? Reflect.getMetadata(SCOPES_KEY, exported),
          idempotent: Reflect.getMetadata(IDEMPOTENT_KEY, handler),
        });
      }
    }
  }
  return routes;
}

describe("API pública /api/v1 (estrutura)", () => {
  const routes = collectRoutes();
  const v1 = routes.filter((r) => r.controllerPath.startsWith("api/v1"));

  it("descobre as rotas da v1 (o teste não passa por estar vazio)", () => {
    expect(v1.length).toBeGreaterThanOrEqual(6);
  });

  it("todas usam ApiKeyGuard e NENHUMA aceita JWT/papéis (as duas portas nunca se misturam)", () => {
    const problems: string[] = [];
    for (const r of v1) {
      if (!r.guards.includes(ApiKeyGuard)) problems.push(`${r.label}: falta ApiKeyGuard`);
      if (r.guards.includes(JwtAuthGuard)) problems.push(`${r.label}: não pode usar JwtAuthGuard`);
      if (r.guards.includes(RolesGuard)) problems.push(`${r.label}: não pode usar RolesGuard`);
    }
    expect(problems).toEqual([]);
  });

  it("nenhuma rota FORA da /api/v1 aceita chaves de API", () => {
    const outside = routes.filter((r) => !r.controllerPath.startsWith("api/v1") && r.guards.includes(ApiKeyGuard));
    expect(outside.map((r) => r.label)).toEqual([]);
  });

  it("todas declaram @Scopes(...) e só com âmbitos que existem", () => {
    const problems: string[] = [];
    for (const r of v1) {
      if (!r.scopes) problems.push(`${r.label}: falta @Scopes()`);
      for (const s of r.scopes ?? []) if (!ALL_SCOPES.includes(s as never)) problems.push(`${r.label}: âmbito desconhecido ${s}`);
    }
    expect(problems).toEqual([]);
  });

  it("todo o âmbito registado é usado por alguma rota (não ficam âmbitos órfãos)", () => {
    const used = new Set(v1.flatMap((r) => r.scopes ?? []));
    expect(ALL_SCOPES.filter((s) => !used.has(s))).toEqual([]);
  });

  it("toda a rota de escrita (POST/PUT/PATCH/DELETE) é @Idempotent", () => {
    const writes = v1.filter((r) => r.method !== RequestMethod.GET);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.filter((r) => !r.idempotent).map((r) => r.label)).toEqual([]);
  });
});
