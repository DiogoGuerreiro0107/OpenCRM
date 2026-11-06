import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import { RequestMethod } from "@nestjs/common";
import { Role } from "@prisma/client";
import { ROLES_KEY, WRITE_ROLES_KEY } from "./decorators/roles.decorator";
import { InternalApiKeyGuard } from "./guards/internal-api-key.guard";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { WRITE_ACCESS } from "./permissions";

/**
 * Teste estrutural: percorre TODOS os controllers (descobertos no disco) e falha se existir uma rota que
 * altera dados sem política de permissões. Garante que um endpoint novo não fica aberto por esquecimento.
 */
const SRC = path.resolve(__dirname, "..");

function findControllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findControllerFiles(full);
    return entry.name.endsWith(".controller.ts") ? [full] : [];
  });
}

interface RouteInfo {
  label: string;
  controllerPath: string;
  httpMethod: RequestMethod;
  guards: unknown[];
  hasPolicy: boolean;
}

function collectRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const file of findControllerFiles(SRC)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== "function") continue;
      const controllerPath = Reflect.getMetadata("path", exported);
      if (controllerPath === undefined) continue; // não é um @Controller

      const classGuards: unknown[] = Reflect.getMetadata("__guards__", exported) ?? [];
      const proto = exported.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === "constructor" || typeof handler !== "function") continue;
        const httpMethod: RequestMethod | undefined = Reflect.getMetadata("method", handler);
        if (httpMethod === undefined) continue; // não é uma rota

        const handlerGuards: unknown[] = Reflect.getMetadata("__guards__", handler) ?? [];
        const hasPolicy = [ROLES_KEY, WRITE_ROLES_KEY].some(
          (key) => Reflect.getMetadata(key, handler) !== undefined || Reflect.getMetadata(key, exported) !== undefined,
        );
        routes.push({
          label: `${RequestMethod[httpMethod]} ${controllerPath}/${Reflect.getMetadata("path", handler)} (${exported.name}.${name})`,
          controllerPath: String(controllerPath),
          httpMethod,
          guards: [...classGuards, ...handlerGuards],
          hasPolicy,
        });
      }
    }
  }
  return routes;
}

describe("cobertura de permissões nos controllers", () => {
  const routes = collectRoutes();
  const writes = routes.filter((r) => r.httpMethod !== RequestMethod.GET);

  it("descobre os controllers (o teste não passa por estar vazio)", () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(writes.length).toBeGreaterThan(30);
  });

  it("todas as rotas de escrita têm JwtAuthGuard + RolesGuard + política (ou são rotas de máquina/autenticação)", () => {
    const problems: string[] = [];
    for (const route of writes) {
      if (route.guards.includes(InternalApiKeyGuard)) continue; // email-worker, chave interna
      if (route.controllerPath === "auth") continue; // login/refresh/reset: sem sessão por definição

      if (!route.guards.includes(JwtAuthGuard)) problems.push(`${route.label}: falta JwtAuthGuard`);
      if (!route.guards.includes(RolesGuard)) problems.push(`${route.label}: falta RolesGuard`);
      if (!route.hasPolicy) problems.push(`${route.label}: falta @WriteRoles/@Roles`);
    }
    expect(problems).toEqual([]);
  });

  it("nenhuma rota de leitura autenticada fica sem JwtAuthGuard (exceto as públicas conhecidas)", () => {
    const publicReads = routes.filter((r) => r.httpMethod === RequestMethod.GET && !r.guards.includes(JwtAuthGuard));
    expect(publicReads.map((r) => r.label)).toEqual([]);
  });
});

describe("matriz WRITE_ACCESS", () => {
  const validRoles = Object.values(Role) as string[];

  it("só contém papéis que existem", () => {
    for (const [name, roles] of Object.entries(WRITE_ACCESS)) {
      for (const role of roles) expect({ name, role, valid: validRoles.includes(role) }).toEqual({ name, role, valid: true });
    }
  });

  it("LEITURA_APENAS nunca tem permissão de escrita", () => {
    for (const roles of Object.values(WRITE_ACCESS)) expect(roles).not.toContain("LEITURA_APENAS");
  });

  it("o Administrador pode sempre escrever", () => {
    for (const roles of Object.values(WRITE_ACCESS)) expect(roles).toContain("ADMINISTRADOR");
  });

  it("configuração sensível é só do Administrador", () => {
    expect(WRITE_ACCESS.adminOnly).toEqual(["ADMINISTRADOR"]);
  });
});
