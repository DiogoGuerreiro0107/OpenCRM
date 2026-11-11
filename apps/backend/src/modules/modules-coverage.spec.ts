import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import { isModuleId } from "./module-manifest";
import { ModuleGuard } from "./module.guard";
import { MODULE_KEY } from "./require-module.decorator";

/**
 * Teste estrutural: cada controller tem de ser "núcleo" (sempre ativo) ou pertencer a um módulo opcional
 * (`@RequireModule` + `ModuleGuard` em todas as rotas). Um controller novo sem decisão faz o teste falhar —
 * senão um módulo novo ficaria "ligado para sempre" por esquecimento.
 */
const CORE_CONTROLLERS = [
  "AuditController",
  "AuthController",
  "UsersController",
  "CompaniesController",
  "ContactsController",
  "TimelineController",
  "TasksController",
  "CustomFieldsController",
  "DashboardController",
  "ModulesController",
];

const SRC = path.resolve(__dirname, "..");

function findControllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findControllerFiles(full);
    return entry.name.endsWith(".controller.ts") ? [full] : [];
  });
}

interface ControllerInfo {
  name: string;
  classModule: unknown;
  routes: Array<{ label: string; guards: unknown[]; module: unknown }>;
}

function collectControllers(): ControllerInfo[] {
  const controllers: ControllerInfo[] = [];
  for (const file of findControllerFiles(SRC)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== "function" || Reflect.getMetadata("path", exported) === undefined) continue;
      const classGuards: unknown[] = Reflect.getMetadata("__guards__", exported) ?? [];
      const proto = exported.prototype as Record<string, unknown>;
      const routes: ControllerInfo["routes"] = [];
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === "constructor" || typeof handler !== "function" || Reflect.getMetadata("method", handler) === undefined) continue;
        routes.push({
          label: `${exported.name}.${name}`,
          guards: [...classGuards, ...(Reflect.getMetadata("__guards__", handler) ?? [])],
          module: Reflect.getMetadata(MODULE_KEY, handler) ?? Reflect.getMetadata(MODULE_KEY, exported),
        });
      }
      controllers.push({ name: exported.name, classModule: Reflect.getMetadata(MODULE_KEY, exported), routes });
    }
  }
  return controllers;
}

describe("cobertura de módulos nos controllers", () => {
  const controllers = collectControllers();
  const optional = controllers.filter((c) => !CORE_CONTROLLERS.includes(c.name));

  it("descobre os controllers (o teste não passa por estar vazio)", () => {
    expect(controllers.length).toBeGreaterThanOrEqual(15);
    expect(optional.length).toBeGreaterThanOrEqual(6);
  });

  it("a lista de núcleo não tem nomes que já não existem", () => {
    const names = controllers.map((c) => c.name);
    expect(CORE_CONTROLLERS.filter((n) => !names.includes(n))).toEqual([]);
  });

  it("os controllers de núcleo não pertencem a nenhum módulo opcional", () => {
    const wrong = controllers.filter((c) => CORE_CONTROLLERS.includes(c.name) && c.routes.some((r) => r.module));
    expect(wrong.map((c) => c.name)).toEqual([]);
  });

  it("todos os outros têm @RequireModule com um módulo que existe, e ModuleGuard em TODAS as rotas", () => {
    const problems: string[] = [];
    for (const controller of optional) {
      for (const route of controller.routes) {
        if (!route.module) problems.push(`${route.label}: falta @RequireModule (ou acrescentar o controller ao núcleo)`);
        else if (typeof route.module !== "string" || !isModuleId(route.module)) problems.push(`${route.label}: módulo "${String(route.module)}" não existe`);
        if (!route.guards.includes(ModuleGuard)) problems.push(`${route.label}: falta ModuleGuard`);
      }
    }
    expect(problems).toEqual([]);
  });
});
