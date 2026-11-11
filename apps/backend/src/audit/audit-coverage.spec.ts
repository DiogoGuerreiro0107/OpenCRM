import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import { RequestMethod } from "@nestjs/common";
import { ROLES_KEY, WRITE_ROLES_KEY } from "../auth/decorators/roles.decorator";
import { AUDIT_KEY } from "./audit.decorator";

/**
 * Teste estrutural: toda a rota de ESCRITA só do Administrador (configuração, utilizadores, módulos, credenciais)
 * tem de estar marcada com @Audit. Um endpoint de administração novo sem decisão faz falhar o CI, para não ficar
 * fora do registo por esquecimento.
 */
const SRC = path.resolve(__dirname, "..");

function findControllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findControllerFiles(full);
    return entry.name.endsWith(".controller.ts") ? [full] : [];
  });
}

interface Route {
  label: string;
  method: RequestMethod;
  effectiveRoles: string[] | undefined;
  audit: { action: string } | undefined;
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
      const proto = exported.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === "constructor" || typeof handler !== "function") continue;
        const method: RequestMethod | undefined = Reflect.getMetadata("method", handler);
        if (method === undefined) continue;

        // Mesma regra do RolesGuard para escritas: política do handler, senão a da classe.
        const roles = (key: string) => Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, exported);
        routes.push({
          label: `${RequestMethod[method]} ${controllerPath}/${Reflect.getMetadata("path", handler)} (${exported.name}.${name})`,
          method,
          effectiveRoles: roles(WRITE_ROLES_KEY) ?? roles(ROLES_KEY),
          audit: Reflect.getMetadata(AUDIT_KEY, handler) ?? Reflect.getMetadata(AUDIT_KEY, exported),
        });
      }
    }
  }
  return routes;
}

describe("cobertura de auditoria nos controllers", () => {
  const routes = collectRoutes();
  const adminWrites = routes.filter(
    (r) => r.method !== RequestMethod.GET && r.effectiveRoles?.length === 1 && r.effectiveRoles[0] === "ADMINISTRADOR",
  );

  it("descobre as rotas de escrita de administração (o teste não passa por estar vazio)", () => {
    expect(adminWrites.length).toBeGreaterThanOrEqual(15);
  });

  it("todas as rotas de escrita só do Administrador estão marcadas com @Audit", () => {
    expect(adminWrites.filter((r) => !r.audit).map((r) => r.label)).toEqual([]);
  });

  it("as ações têm o formato 'recurso.acao' e não se repetem entre rotas", () => {
    const actions = routes.filter((r) => r.audit).map((r) => r.audit!.action);
    for (const action of actions) expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
    expect(actions.filter((a, i) => actions.indexOf(a) !== i)).toEqual([]);
  });
});
