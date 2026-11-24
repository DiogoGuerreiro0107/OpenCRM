import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import { RequestMethod } from "@nestjs/common";
import { Role } from "@prisma/client";
import { ROLES_KEY, WRITE_ROLES_KEY } from "./decorators/roles.decorator";
import { InternalApiKeyGuard } from "./guards/internal-api-key.guard";
import { ApiKeyGuard } from "../public-api/api-key.guard";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { ADMIN_ONLY, WRITE_AREAS } from "./permissions";
import { WRITE_AREA_KEY } from "./decorators/roles.decorator";

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
  controller: string;
  handlerName: string;
  /** Área configurável que decide a escrita (método antes da classe, como o RolesGuard), se houver. */
  writeArea: string | undefined;
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
        const area = Reflect.getMetadata(WRITE_AREA_KEY, handler) ?? Reflect.getMetadata(WRITE_AREA_KEY, exported);
        if (area !== undefined && !(area in WRITE_AREAS)) throw new Error(`${exported.name}.${name}: área desconhecida «${area}»`);
        const hasPolicy = [ROLES_KEY, WRITE_ROLES_KEY, WRITE_AREA_KEY].some(
          (key) => Reflect.getMetadata(key, handler) !== undefined || Reflect.getMetadata(key, exported) !== undefined,
        );
        routes.push({
          label: `${RequestMethod[httpMethod]} ${controllerPath}/${Reflect.getMetadata("path", handler)} (${exported.name}.${name})`,
          controllerPath: String(controllerPath),
          httpMethod,
          guards: [...classGuards, ...handlerGuards],
          hasPolicy,
          controller: exported.name,
          handlerName: name,
          writeArea: Reflect.getMetadata(WRITE_AREA_KEY, handler) ??
            (Reflect.getMetadata(WRITE_ROLES_KEY, handler) ? undefined : Reflect.getMetadata(WRITE_AREA_KEY, exported)),
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
      if (route.guards.includes(ApiKeyGuard)) continue; // API pública: coberta por public-api-coverage.spec.ts
      if (route.controllerPath === "auth") continue; // login/refresh/reset: sem sessão por definição

      if (!route.guards.includes(JwtAuthGuard)) problems.push(`${route.label}: falta JwtAuthGuard`);
      if (!route.guards.includes(RolesGuard)) problems.push(`${route.label}: falta RolesGuard`);
      if (!route.hasPolicy) problems.push(`${route.label}: falta @WriteRoles/@Roles`);
    }
    expect(problems).toEqual([]);
  });

  // Fase 0d: a administração NUNCA pode depender de uma área configurável (senão alguém poderia dar-se a si próprio
  // acesso à gestão de utilizadores, permissões, chaves...). Só as exceções listadas (trabalho do dia-a-dia dentro de
  // controllers de administração) podem usar uma área.
  it("as rotas de escrita dos controllers de administração não usam áreas configuráveis", () => {
    const ADMIN_CONTROLLERS = [
      "UsersController",
      "ModulesController",
      "PermissionsController",
      "ApiKeysController",
      "WebhooksController",
      "AuditController",
      "AutomationsController",
      "PipelinesController",
      "CustomFieldsController",
      "ZadarmaController",
      "WorkItemTypesController",
      "WorkflowsController",
      "MenuSettingsController",
    ];
    const ALLOWED = ["CustomFieldsController.upsertValues", "ZadarmaController.makeCall"];
    const found = new Set(routes.map((r) => r.controller));
    expect(ADMIN_CONTROLLERS.filter((c) => !found.has(c))).toEqual([]); // a lista não tem nomes que já não existem
    const offenders = writes
      .filter((r) => ADMIN_CONTROLLERS.includes(r.controller) && r.writeArea && !ALLOWED.includes(`${r.controller}.${r.handlerName}`))
      .map((r) => `${r.label}: usa a área «${r.writeArea}»`);
    expect(offenders).toEqual([]);
  });

  it("nenhuma rota de leitura autenticada fica sem JwtAuthGuard (exceto as públicas conhecidas)", () => {
    // A chave interna (email-worker) é a única alternativa aceite ao JWT numa rota de leitura.
    const publicReads = routes.filter(
      (r) =>
        r.httpMethod === RequestMethod.GET &&
        !r.guards.includes(JwtAuthGuard) &&
        !r.guards.includes(InternalApiKeyGuard) &&
        !r.guards.includes(ApiKeyGuard),
    );
    expect(publicReads.map((r) => r.label)).toEqual([]);
  });
});

describe("predefinições das permissões (Fase 0d)", () => {
  const validRoles = Object.values(Role) as string[];
  const defaults = Object.entries(WRITE_AREAS).map(([name, def]) => [name, def.defaultRoles] as const);

  it("só contêm papéis que existem", () => {
    for (const [name, roles] of defaults) {
      for (const role of roles) expect({ name, role, valid: validRoles.includes(role) }).toEqual({ name, role, valid: true });
    }
  });

  it("LEITURA_APENAS nunca tem permissão de escrita", () => {
    for (const [, roles] of defaults) expect(roles).not.toContain("LEITURA_APENAS");
  });

  it("o Administrador pode sempre escrever", () => {
    for (const [, roles] of defaults) expect(roles).toContain("ADMINISTRADOR");
  });

  it("configuração sensível é só do Administrador (e não é uma área configurável)", () => {
    expect(ADMIN_ONLY).toEqual(["ADMINISTRADOR"]);
    expect(Object.keys(WRITE_AREAS)).not.toContain("adminOnly");
  });

  it("as predefinições são exatamente a matriz de antes da Fase 0d (instalar o 0d não muda nada)", () => {
    expect(Object.fromEntries(defaults.map(([n, r]) => [n, [...r].sort()]))).toEqual({
      companies: ["ADMINISTRADOR", "BACKOFFICE", "COMERCIAL", "FINANCEIRO"],
      contacts: ["ADMINISTRADOR", "BACKOFFICE", "COMERCIAL"],
      leads: ["ADMINISTRADOR", "BACKOFFICE", "COMERCIAL"],
      deals: ["ADMINISTRADOR", "BACKOFFICE", "COMERCIAL"],
      dailyWork: ["ADMINISTRADOR", "BACKOFFICE", "COMERCIAL", "FINANCEIRO", "TECNICO"],
      sendEmail: ["ADMINISTRADOR", "BACKOFFICE", "COMERCIAL"],
      makeCall: ["ADMINISTRADOR", "BACKOFFICE", "COMERCIAL", "TECNICO"],
      emailTemplates: ["ADMINISTRADOR", "BACKOFFICE"],
      // Área nova (Fase 5a): não muda quem escrevia antes, porque o catálogo não existia.
      catalog: ["ADMINISTRADOR", "BACKOFFICE", "FINANCEIRO"],
      // Área nova (Fase 5b).
      stock: ["ADMINISTRADOR", "BACKOFFICE"],
      // Área nova (Fase 6a).
      orders: ["ADMINISTRADOR", "BACKOFFICE", "COMERCIAL"],
    });
  });
});
