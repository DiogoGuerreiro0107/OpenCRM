import { Injectable, OnModuleInit } from "@nestjs/common";
import { ModulesService } from "../modules/modules.service";
import { BUILTIN_EXTENSIONS } from "./builtin";
import { manifestSetErrors } from "./manifest";
import { describePermission } from "./permissions";

/**
 * Extensões do CRM (Fase E1.1, docs/plano-fase-e1-extensoes.md). Por agora só as embutidas (os módulos); o estado
 * ligado/desligado é o do registo de módulos.
 */
@Injectable()
export class ExtensionsService implements OnModuleInit {
  constructor(private readonly modules: ModulesService) {}

  /** Um manifesto embutido inválido é erro de programação: o backend não arranca (o CI apanha-o antes). */
  onModuleInit() {
    const errors = manifestSetErrors(BUILTIN_EXTENSIONS);
    if (errors.length) throw new Error(`Manifestos de extensões inválidos:\n- ${errors.join("\n- ")}`);
  }

  list() {
    const enabled = new Set<string>(this.modules.enabledIds());
    return BUILTIN_EXTENSIONS.map((m) => ({
      ...m,
      enabled: enabled.has(m.id),
      dependents: BUILTIN_EXTENSIONS.filter((other) => m.id in other.dependsOn).map((other) => other.id),
      permissions: m.permissions.map((p) => ({ permission: p, description: describePermission(p)! })),
      hasSettings: m.settings.length > 0,
    }));
  }
}
